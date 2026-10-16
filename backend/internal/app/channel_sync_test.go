package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
	"yingce/backend/internal/channelsync"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestChannelSyncReactivatesAfterPriceRecoveryAndKeepsUnconfiguredModelsDisabled(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	phase := "missing"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			if r.Header.Get("Authorization") != "Bearer test-credential" {
				t.Error("saved credential missing")
			}
			_, _ = w.Write([]byte(`{"data":[{"id":"ready"},{"id":"broken"},{"id":"new"}]}`))
			return
		}
		switch phase {
		case "missing":
			_, _ = w.Write([]byte(`{"code":0,"data":{"groups":[{"id":95,"rate_multiplier":1,"models":[{"name":"other"}]}]}}`))
		case "empty group":
			_, _ = w.Write([]byte(`{"code":0,"data":{"groups":[{"id":95,"rate_multiplier":1,"models":[]}]}}`))
		case "failure":
			w.WriteHeader(http.StatusBadGateway)
		default:
			_, _ = w.Write([]byte(`{"code":0,"data":{"groups":[{"id":95,"rate_multiplier":1,"models":[{"name":"ready","pricing":{"billing_mode":"image","per_request_price":0.000008}},{"name":"broken","pricing":{"billing_mode":"image","per_request_price":0.000008}},{"name":"new","pricing":{"billing_mode":"image","per_request_price":0.000008}}]}]}}`))
		}
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "restore-channel", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL, APIKey: "test-credential", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"ready", "broken", "new"} {
		item := model.ChannelModel{ID: key, ChannelID: channel.ID, ModelKey: key, PriceVersion: 1}
		if key != "new" {
			item.Capability = "image"
			item.Protocol = model.ChannelInterfaceOpenAIImage
			item.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, DefaultModelCapabilityConfigForModel(string(item.Protocol), key))
			if key == "broken" {
				item.CapabilityConfigJSON = `{`
			}
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		if key != "new" {
			tier := model.ChannelModelPriceTier{ID: key + "-tier", ChannelModelID: item.ID, SelectorJSON: `{}`, Resolution: "*", BillingMode: "fixed_request", Enabled: true, PriceConfigured: true, UnitPriceMicrocredits: 5, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: 4}}
			if err := db.Create(&tier).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	job := model.ChannelSyncJob{ChannelID: channel.ID, Script: "model-plaza", SourceURL: upstream.URL + "/prices", GroupID: 95, SyncPrices: true}
	if err := svc.repo.SaveChannelSyncJob(&job); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		phase, status         string
		enabled               bool
		activations, disabled int
	}{
		{"missing", "success", false, 0, 0},
		{"restored", "success", true, 1, 0},
		{"unchanged", "success", true, 0, 0},
		{"empty group", "success", false, 0, 1},
		{"failure", "failed", false, 0, 0},
		{"restored again", "success", true, 1, 0},
	} {
		phase = tc.phase
		currentJob, err := svc.repo.ChannelSyncJob(channel.ID)
		if err != nil {
			t.Fatal(err)
		}
		job = *currentJob
		run, err := svc.claimChannelSync(job, "manual", "admin")
		if err != nil {
			t.Fatal(err)
		}
		svc.executeChannelSync(context.Background(), job, *run)
		runs, err := svc.repo.ChannelSyncRuns(channel.ID, 1)
		if err != nil || len(runs) != 1 || runs[0].Status != tc.status {
			t.Fatalf("%s: runs = %#v, %v", phase, runs, err)
		}
		items, err := svc.repo.ChannelModels(channel.ID, true)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range items {
			want := item.ModelKey == "ready" && tc.enabled
			if item.Enabled != want {
				t.Fatalf("%s: %s enabled = %v", phase, item.ModelKey, item.Enabled)
			}
			if want && (item.PriceTiers[0].UnitPriceMicrocredits != 10 || item.PriceTiers[0].CostPricing.UnitPriceMicrocredits != 8) {
				t.Fatalf("restored wrong pricing: %#v", item)
			}
		}
		if tc.status == "success" {
			var summary channelsync.Summary
			if err := json.Unmarshal([]byte(runs[0].Summary), &summary); err != nil {
				t.Fatal(err)
			}
			if summary.Enabled != tc.activations || summary.Disabled != tc.disabled {
				t.Fatalf("%s: summary = %#v", phase, summary)
			}
		}
	}
}

func TestChannelSyncMissingPriceSucceedsButRequestFailurePreservesModels(t *testing.T) {
	for _, tc := range []struct {
		name          string
		failedRequest bool
	}{{"missing price", false}, {"request failure", true}} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			svc, db := newChannelModelTestService(t)
			if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
				t.Fatal(err)
			}
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/models" {
					_, _ = w.Write([]byte(`{"data":[{"id":"gpt-image-2-adobe"}]}`))
					return
				}
				if tc.failedRequest {
					w.WriteHeader(http.StatusBadGateway)
					return
				}
				_, _ = w.Write([]byte(`{"code":0,"data":{"groups":[{"id":83,"rate_multiplier":1,"models":[{"name":"other"}]}]}}`))
			}))
			defer upstream.Close()
			channel := model.ModelChannel{ID: "price-channel", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL, APIKey: "test-credential", APIFormat: "openai"}
			if err := db.Create(&channel).Error; err != nil {
				t.Fatal(err)
			}
			item := model.ChannelModel{ID: "adobe", ChannelID: channel.ID, ModelKey: "gpt-image-2-adobe", Enabled: true, PriceVersion: 1}
			if err := db.Create(&item).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.ChannelModelPriceTier{ID: "adobe-tier", ChannelModelID: item.ID, Enabled: true, PriceConfigured: true, UnitPriceMicrocredits: 50000}).Error; err != nil {
				t.Fatal(err)
			}
			job := model.ChannelSyncJob{ChannelID: channel.ID, Script: "model-plaza", SourceURL: upstream.URL + "/prices", GroupID: 83, SyncPrices: true}
			if err := svc.repo.SaveChannelSyncJob(&job); err != nil {
				t.Fatal(err)
			}
			run, err := svc.claimChannelSync(job, "manual", "admin")
			if err != nil {
				t.Fatal(err)
			}
			svc.executeChannelSync(context.Background(), job, *run)
			runs, err := svc.repo.ChannelSyncRuns(channel.ID, 1)
			if err != nil || len(runs) != 1 {
				t.Fatalf("runs = %#v, %v", runs, err)
			}
			if err := db.First(&item, "id = ?", item.ID).Error; err != nil {
				t.Fatal(err)
			}
			if tc.failedRequest {
				if runs[0].Status != "failed" || !item.Enabled || item.PriceVersion != 1 {
					t.Fatalf("request failure changed model: %#v, %#v", runs[0], item)
				}
				return
			}
			var summary channelsync.Summary
			if err := json.Unmarshal([]byte(runs[0].Summary), &summary); err != nil {
				t.Fatal(err)
			}
			if runs[0].Status != "success" || item.Enabled || summary.Disabled != 1 || len(summary.Warnings) != 1 || summary.Warnings[0] != "gpt-image-2-adobe：上游未提供价格，相关模型已停用" {
				t.Fatalf("missing price outcome: %#v, %#v", runs[0], item)
			}
		})
	}
}

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
	if err != nil || claimed.NextRunAt == nil || !claimed.NextRunAt.Equal(channelsync.NextRunAt(run.StartedAt)) {
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

func TestChannelSyncSuccessDisablesModelsAndRecordsWarning(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: "missing-price-group", Scope: model.ChannelScopeSystem, Enabled: true}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModel{ID: "unsafe", ChannelID: channel.ID, ModelKey: "unsafe", Enabled: true, PriceVersion: 4}).Error; err != nil {
		t.Fatal(err)
	}
	next := time.Now().Add(-time.Minute)
	job := model.ChannelSyncJob{ChannelID: channel.ID, Enabled: true, Script: "model-plaza", NextRunAt: &next}
	if err := svc.repo.SaveChannelSyncJob(&job); err != nil {
		t.Fatal(err)
	}
	run, err := svc.claimChannelSync(job, "manual", "admin")
	if err != nil {
		t.Fatal(err)
	}
	items, err := svc.repo.ChannelModels(channel.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	items[0].Enabled = false
	run.Status = "success"
	run.Summary = `{"authorized":1,"added":0,"disabled":1,"prices":0,"descriptions":0,"warnings":["上游价格分组不存在或为空，相关模型已停用"]}`
	finished := time.Now()
	run.FinishedAt = &finished
	if err := svc.repo.FinishChannelSync(run, &channel, items, nil); err != nil {
		t.Fatal(err)
	}
	var disabled model.ChannelModel
	if err := db.First(&disabled, "id = ?", "unsafe").Error; err != nil {
		t.Fatal(err)
	}
	if disabled.Enabled || disabled.PriceVersion != 5 {
		t.Fatalf("model = %#v, want disabled and version 5", disabled)
	}
	var savedRun model.ChannelSyncRun
	if err := db.First(&savedRun, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if savedRun.Status != "success" || savedRun.Summary != run.Summary {
		t.Fatalf("run = %#v", savedRun)
	}
	claimed, err := svc.repo.ChannelSyncJob(channel.ID)
	if err != nil || claimed.LeaseExpiresAt != nil {
		t.Fatalf("lease = %#v, %v", claimed, err)
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

func TestChannelSyncBringForwardPreservesDuePausedAndLeasedJobs(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.ChannelSyncJob{}, &model.ChannelSyncRun{}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 16, 1, 12, 0, 0, time.UTC)
	next := channelsync.NextRunAt(now)
	later := now.Add(12 * time.Hour)
	due := now.Add(-time.Minute)
	lease := now.Add(time.Minute)
	jobs := []model.ChannelSyncJob{
		{ChannelID: "daily", Enabled: true, NextRunAt: &later},
		{ChannelID: "missing", Enabled: true},
		{ChannelID: "due", Enabled: true, NextRunAt: &due},
		{ChannelID: "paused", Enabled: false},
		{ChannelID: "running", Enabled: true, NextRunAt: &later, LeaseExpiresAt: &lease},
	}
	if err := db.Create(&jobs).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.BringForwardChannelSyncJobs(now, next); err != nil {
		t.Fatal(err)
	}
	for _, original := range jobs {
		job, err := svc.repo.ChannelSyncJob(original.ChannelID)
		if err != nil {
			t.Fatal(err)
		}
		want := original.NextRunAt
		if job.ChannelID == "daily" || job.ChannelID == "missing" {
			want = &next
		}
		if want == nil {
			if job.NextRunAt != nil {
				t.Fatalf("paused job was scheduled: %#v", job)
			}
		} else if job.NextRunAt == nil || !job.NextRunAt.Equal(*want) {
			t.Fatalf("%s next run = %v, want %v", job.ChannelID, job.NextRunAt, want)
		}
		if job.ChannelID == "running" && (job.LeaseExpiresAt == nil || !job.LeaseExpiresAt.Equal(lease)) {
			t.Fatal("running lease changed")
		}
	}
}
