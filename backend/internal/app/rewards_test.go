package app

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func completedRewardTask(id, userID string) model.Task {
	started := time.Now().Add(-time.Minute)
	completed := time.Now()
	return model.Task{ID: id, UserID: userID, Type: "canvas_text", Status: model.TaskStatusSucceeded, Attempts: 1, StartedAt: &started, CompletedAt: &completed, InputJSON: `{"mode":"text"}`, ResultJSON: `{"mode":"text","text":"generated text"}`}
}

func newRewardsService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.CanvasShare{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RewardClaim{}, &model.Membership{}, &model.RedeemCode{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestClaimTaskRewardRequiresSuccessfulOwnedTaskAndIsIdempotent(t *testing.T) {
	svc, db := newRewardsService(t)
	task := completedRewardTask("task-success", "user-1")
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "task-running", UserID: "user-1", Status: model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}
	if _, granted, err := svc.ClaimTaskReward("user-1", "task-running"); err == nil || granted {
		t.Fatalf("running task granted=%v err=%v", granted, err)
	}
	if _, granted, err := svc.ClaimTaskReward("user-2", "task-success"); err == nil || granted {
		t.Fatalf("foreign task granted=%v err=%v", granted, err)
	}
	account, granted, err := svc.ClaimTaskReward("user-1", "task-success")
	if err != nil || !granted || account.AvailableMicrocredits != CreditScale {
		t.Fatalf("first task claim account=%#v granted=%v err=%v", account, granted, err)
	}
	account, granted, err = svc.ClaimTaskReward("user-1", "task-success")
	if err != nil || granted || account.AvailableMicrocredits != CreditScale {
		t.Fatalf("duplicate task claim account=%#v granted=%v err=%v", account, granted, err)
	}
}

func TestClaimTaskRewardRejectsUnverifiedGeneration(t *testing.T) {
	cases := []struct {
		name   string
		change func(*model.Task)
	}{
		{"status_only", func(task *model.Task) {
			*task = model.Task{ID: task.ID, UserID: task.UserID, Status: model.TaskStatusSucceeded}
		}},
		{"no_execution", func(task *model.Task) { task.Attempts = 0 }},
		{"not_started", func(task *model.Task) { task.StartedAt = nil }},
		{"not_completed", func(task *model.Task) { task.CompletedAt = nil }},
		{"no_result", func(task *model.Task) { task.ResultJSON = "" }},
		{"empty_result", func(task *model.Task) { task.ResultJSON = `{}` }},
		{"invalid_result", func(task *model.Task) { task.ResultJSON = `invalid` }},
		{"client_replay", func(task *model.Task) { task.InputJSON = `{"mode":"text","replay":true}` }},
		{"client_replay_string", func(task *model.Task) { task.InputJSON = `{"mode":"text","replay":"TRUE"}` }},
		{"invalid_input", func(task *model.Task) { task.InputJSON = `invalid` }},
		{"internal_task", func(task *model.Task) { task.Type = "timeline_render" }},
		{"failed", func(task *model.Task) { task.Status = model.TaskStatusFailed }},
		{"queued", func(task *model.Task) { task.Status = model.TaskStatusQueued }},
		{"cancelled", func(task *model.Task) { task.Status = model.TaskStatusCancelled }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, db := newRewardsService(t)
			task := completedRewardTask("task-1", "user-1")
			tc.change(&task)
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			if _, granted, err := svc.ClaimTaskReward("user-1", task.ID); err == nil || granted {
				t.Fatalf("unverified task granted=%v err=%v", granted, err)
			}
			for _, table := range []any{&model.CreditLedgerEntry{}, &model.RewardClaim{}} {
				var count int64
				if err := db.Model(table).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("unexpected reward writes=%d err=%v", count, err)
				}
			}
		})
	}
}

func TestClaimTaskRewardRejectsClientCompletedReplay(t *testing.T) {
	svc, db := newRewardsService(t)
	task := model.Task{ID: "replay", UserID: "user-1", Type: "canvas_text", Status: model.TaskStatusTextReplay, InputJSON: `{"mode":"text","replay":true}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if completed, err := svc.repo.CompleteTextReplayTask("user-1", task.ID, `{"mode":"text","text":"client supplied"}`, time.Now()); err != nil || !completed {
		t.Fatalf("complete replay=%v err=%v", completed, err)
	}
	if _, granted, err := svc.ClaimTaskReward("user-1", task.ID); err == nil || granted {
		t.Fatalf("client completed replay granted=%v err=%v", granted, err)
	}
}

func TestClaimTaskRewardAllowsExecutedGenerationTypes(t *testing.T) {
	for _, tc := range []struct{ taskType, result string }{
		{"canvas_text", `{"mode":"text","text":"generated text"}`},
		{"canvas_image", `{"mode":"image","images":[{"resourceId":"image-1"}]}`},
		{"canvas_video", `{"mode":"video","video":{"resourceId":"video-1"}}`},
		{"canvas_audio", `{"mode":"audio","audio":{"resourceId":"audio-1"}}`},
		{"video_generate", `{"mode":"video","video":{"resourceId":"video-2"}}`},
	} {
		t.Run(tc.taskType, func(t *testing.T) {
			svc, db := newRewardsService(t)
			task := completedRewardTask("task-1", "user-1")
			task.Type, task.ResultJSON = tc.taskType, tc.result
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			account, granted, err := svc.ClaimTaskReward("user-1", task.ID)
			if err != nil || !granted || account.AvailableMicrocredits != 1_000_000 {
				t.Fatalf("account=%#v granted=%v err=%v", account, granted, err)
			}
		})
	}
}

func TestRewardsRejectsMissingIdentityAndReturnsEmptyTaskArray(t *testing.T) {
	svc, _ := newRewardsService(t)
	for _, user := range []*model.User{nil, {ID: ""}, {ID: " "}} {
		if _, err := svc.Rewards(user); err == nil {
			t.Fatalf("missing user accepted: %#v", user)
		}
	}
	for _, args := range [][2]string{{"", "task-1"}, {"user-1", ""}, {"user-1", "missing"}} {
		if _, granted, err := svc.ClaimTaskReward(args[0], args[1]); err == nil || granted {
			t.Fatalf("invalid claim %v granted=%v err=%v", args, granted, err)
		}
	}
	summary, err := svc.Rewards(&model.User{ID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	if summary.GenerationTasks == nil || len(summary.GenerationTasks) != 0 {
		t.Fatalf("empty tasks=%#v", summary.GenerationTasks)
	}
}

func TestRewardsListsVerifiedOwnedTasksWithPersistedClaimState(t *testing.T) {
	svc, db := newRewardsService(t)
	replay := completedRewardTask("replay", "user-1")
	replay.InputJSON = `{"mode":"text","replay":true}`
	internal := completedRewardTask("internal", "user-1")
	internal.Type = "timeline_render"
	empty := completedRewardTask("empty", "user-1")
	empty.ResultJSON = `{}`
	for _, task := range []model.Task{
		completedRewardTask("claimed", "user-1"), completedRewardTask("available", "user-1"), completedRewardTask("foreign", "user-2"),
		replay, internal, empty,
		{ID: "unverified", UserID: "user-1", Status: model.TaskStatusSucceeded},
		{ID: "running", UserID: "user-1", Status: model.TaskStatusRunning},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, granted, err := svc.ClaimTaskReward("user-1", "claimed"); err != nil || !granted {
		t.Fatalf("claim=%v err=%v", granted, err)
	}
	if _, granted, err := svc.ClaimTaskReward("user-2", "foreign"); err != nil || !granted {
		t.Fatalf("foreign claim=%v err=%v", granted, err)
	}
	// 同一目标下其他用户和其他奖励类型的记录不能污染领取状态。
	for _, claim := range []model.RewardClaim{
		{ID: "other-user", UserID: "user-2", RewardType: model.CreditLedgerRewardTask, TargetID: "available", ReferenceKey: "other-user"},
		{ID: "other-type", UserID: "user-1", RewardType: model.CreditLedgerRewardShare, TargetID: "available", ReferenceKey: "other-type"},
	} {
		if err := db.Create(&claim).Error; err != nil {
			t.Fatal(err)
		}
	}
	read := func() map[string]bool {
		t.Helper()
		summary, err := svc.Rewards(&model.User{ID: "user-1"})
		if err != nil {
			t.Fatal(err)
		}
		payload, err := json.Marshal(summary)
		if err != nil {
			t.Fatal(err)
		}
		var response struct {
			GenerationTasks []struct {
				ID      string `json:"id"`
				Claimed bool   `json:"claimed"`
			} `json:"generationTasks"`
		}
		if err := json.Unmarshal(payload, &response); err != nil {
			t.Fatal(err)
		}
		got := map[string]bool{}
		for _, task := range response.GenerationTasks {
			got[task.ID] = task.Claimed
		}
		return got
	}
	got := read()
	if len(got) != 2 || !got["claimed"] {
		t.Fatalf("reward tasks=%v", got)
	}
	if claimed, ok := got["available"]; !ok || claimed {
		t.Fatalf("available task state=%v", got)
	}
	if _, granted, err := svc.ClaimTaskReward("user-1", "available"); err != nil || !granted {
		t.Fatalf("claim=%v err=%v", granted, err)
	}
	if got := read(); len(got) != 2 || !got["claimed"] || !got["available"] {
		t.Fatalf("reloaded claim states=%v", got)
	}
}

func TestClaimShareRewardUsesUTCPeriodAndOwnership(t *testing.T) {
	svc, db := newRewardsService(t)
	expires := time.Now().UTC().Add(time.Hour)
	if err := db.Create(&model.CanvasShare{ID: "share-1", UserID: "user-1", ProjectID: "project-1", Enabled: true, ExpiresAt: &expires}).Error; err != nil {
		t.Fatal(err)
	}
	account, granted, err := svc.ClaimShareReward("user-1", "share-1")
	if err != nil || !granted || account.AvailableMicrocredits != 2*CreditScale {
		t.Fatalf("first share claim account=%#v granted=%v err=%v", account, granted, err)
	}
	account, granted, err = svc.ClaimShareReward("user-1", "share-1")
	if err != nil || granted || account.AvailableMicrocredits != 2*CreditScale {
		t.Fatalf("duplicate share claim account=%#v granted=%v err=%v", account, granted, err)
	}
	if _, granted, err = svc.ClaimShareReward("user-2", "share-1"); !errors.Is(err, gorm.ErrRecordNotFound) || granted {
		t.Fatalf("foreign share claim granted=%v err=%v", granted, err)
	}
}

func TestMembershipServiceRedeemsOnlyMembershipCode(t *testing.T) {
	svc, db := newRewardsService(t)
	if err := db.Create(&model.RedeemCode{ID: "member", CodeHash: hashRedeemCode("member-code"), ProductType: model.ProductTypeMembership, MembershipDays: 365, BonusCreditsMicrocredits: 50 * CreditScale, Status: model.RedeemCodeUnused}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RedeemCode{ID: "credits", CodeHash: hashRedeemCode("credits-code"), ProductType: model.ProductTypeCredits, AmountMicrocredits: CreditScale, Status: model.RedeemCodeUnused}).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.RedeemMembershipCode("user-1", "credits-code", ""); err == nil {
		t.Fatalf("points code error=%v", err)
	}
	account, redeemed, err := svc.RedeemMembershipCode("user-1", "member-code", "")
	if err != nil || !redeemed || account.AvailableMicrocredits != 50*CreditScale {
		t.Fatalf("member code account=%#v redeemed=%v err=%v", account, redeemed, err)
	}
}
