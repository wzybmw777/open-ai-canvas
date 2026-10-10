package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
	"yingce/backend/internal/channelsync"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestChannelSyncRequiresAdminAndConfiguredJob(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	user := &model.User{ID: "user", Role: model.UserRoleUser}
	if _, err := svc.AdminChannelSyncJobs(user); err == nil {
		t.Fatal("non-admin can read jobs")
	}
	if _, err := svc.SaveAdminChannelSync(user, "missing", ChannelSyncRequest{}); err == nil {
		t.Fatal("non-admin can save jobs")
	}
	if _, err := svc.RunAdminChannelSync(user, "missing"); err == nil {
		t.Fatal("non-admin can run jobs")
	}
	if _, err := svc.AdminChannelSyncRuns(user, "missing"); err == nil {
		t.Fatal("non-admin can read results")
	}
}

func TestChannelSyncLeaseAndAtomicConflict(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem, Enabled: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"a", "b"} {
		if err := db.Create(&model.ChannelModel{ID: key, ChannelID: channel.ID, ModelKey: key, Description: "before", Enabled: true, PriceVersion: 1}).Error; err != nil {
			t.Fatal(err)
		}
	}
	next := time.Now().Add(-time.Minute)
	job := model.ChannelSyncJob{ChannelID: channel.ID, Enabled: true, Script: "authorized-models", NextRunAt: &next}
	if err := svc.repo.SaveChannelSyncJob(&job); err != nil {
		t.Fatal(err)
	}
	run, err := svc.claimChannelSync(job, "scheduled", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.claimChannelSync(job, "manual", "admin"); !errors.Is(err, repository.ErrChannelSyncBusy) {
		t.Fatalf("second claim = %v", err)
	}
	if err := svc.repo.SaveChannelSyncJob(&job); !errors.Is(err, repository.ErrChannelSyncBusy) {
		t.Fatalf("edit during run = %v", err)
	}
	claimed, err := svc.repo.ChannelSyncJob(channel.ID)
	if err != nil || claimed.NextRunAt == nil || !claimed.NextRunAt.Equal(channelsync.NextMidnight(run.StartedAt)) {
		t.Fatalf("next run = %#v, %v", claimed, err)
	}
	items, err := svc.repo.ChannelModels(channel.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	for i := range items {
		items[i].Description = "after"
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "b").Updates(map[string]any{"description": "admin edit", "price_version": 2}).Error; err != nil {
		t.Fatal(err)
	}
	finished := time.Now()
	run.Status = "success"
	run.FinishedAt = &finished
	if err := svc.repo.FinishChannelSync(run, &channel, items, nil); !errors.Is(err, repository.ErrChannelModelPriceConflict) {
		t.Fatalf("concurrent mutation = %v", err)
	}
	var unchanged model.ChannelModel
	if err := db.First(&unchanged, "id = ?", "a").Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Description != "before" {
		t.Fatal("partial update survived rollback")
	}
	run.Status = "failed"
	run.Summary = "conflict"
	if err := svc.repo.FinishChannelSync(run, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	claimed, _ = svc.repo.ChannelSyncJob(channel.ID)
	if claimed.LeaseExpiresAt != nil {
		t.Fatal("lease not released")
	}
}

func TestChannelSyncDoesNotPersistCredentialErrors(t *testing.T) {
	message := safeChannelSyncError(errors.New("request https://upstream/?api_key=secret failed"))
	if message != "上游同步失败，请检查渠道授权、目录格式和服务器网络" {
		t.Fatal(message)
	}
}

func TestChannelSyncReadsSavedAuthorizationAndFailsClosed(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	empty := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-credential" {
			t.Error("saved credential not used")
			w.WriteHeader(401)
			return
		}
		if r.URL.Path != "/v1/models" {
			t.Error("unexpected path")
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if empty {
			_, _ = w.Write([]byte(`{"data":[]}`))
		} else {
			_, _ = w.Write([]byte(`{"data":[{"id":"available"},{"id":"new"}]}`))
		}
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "http-channel", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL, APIKey: "test-credential", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModel{ID: "removed", ChannelID: channel.ID, ModelKey: "removed", Enabled: true, PriceVersion: 1}).Error; err != nil {
		t.Fatal(err)
	}
	job := model.ChannelSyncJob{ChannelID: channel.ID, Script: "authorized-models", ImportNew: true}
	_, changed, added, _, err := svc.prepareChannelSync(context.Background(), job)
	if err != nil || len(changed) != 1 || changed[0].Enabled || len(added) != 2 || added[0].Enabled {
		t.Fatalf("plan = %#v %#v %v", changed, added, err)
	}
	empty = true
	if _, _, _, _, err := svc.prepareChannelSync(context.Background(), job); err == nil {
		t.Fatal("empty upstream accepted")
	}
	var original model.ChannelModel
	if err := db.First(&original, "id = ?", "removed").Error; err != nil || !original.Enabled {
		t.Fatal("failed prepare modified the database")
	}
}

func TestChannelSyncRecoversInterruptedScheduledRun(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: "recover-channel", Scope: model.ChannelScopeSystem, Enabled: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	old := now.Add(-time.Hour)
	run := model.ChannelSyncRun{ID: "expired", ChannelID: channel.ID, Status: "running", Trigger: "scheduled", StartedAt: old}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	next := now.Add(time.Hour)
	job := model.ChannelSyncJob{ChannelID: channel.ID, Enabled: true, NextRunAt: &next, LastRunID: run.ID, LeaseExpiresAt: &old}
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.RecoverExpiredChannelSync(now); err != nil {
		t.Fatal(err)
	}
	due, err := svc.repo.DueChannelSyncJobs(now)
	if err != nil || len(due) != 1 || due[0].LeaseExpiresAt != nil {
		t.Fatalf("due = %#v %v", due, err)
	}
	runs, _ := svc.repo.ChannelSyncRuns(channel.ID, 1)
	if runs[0].Status != "failed" {
		t.Fatal("interrupted run still appears running")
	}
}

func TestChannelSyncConfigSavePreservesLatestSchedule(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	next := time.Now().Add(time.Hour)
	job := model.ChannelSyncJob{ChannelID: "schedule", Enabled: true, Script: "authorized-models", NextRunAt: &next}
	if err := svc.repo.SaveChannelSyncJob(&job); err != nil {
		t.Fatal(err)
	}
	advanced := next.Add(24 * time.Hour)
	if err := db.Model(&model.ChannelSyncJob{}).Where("channel_id = ?", job.ChannelID).Update("next_run_at", advanced).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveChannelSyncJob(&job); err != nil {
		t.Fatal(err)
	}
	if job.NextRunAt == nil || !job.NextRunAt.Equal(advanced) {
		t.Fatal("stale configuration reset the scheduler and could cause duplicate execution")
	}
}
