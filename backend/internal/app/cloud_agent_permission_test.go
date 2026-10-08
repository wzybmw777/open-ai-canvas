package app

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentRejectsRetiredPermissionBeforeCreatingTasks(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, mode := range []string{"full_access", "unsupported", ""} {
		req := agentTestRequest()
		req.PermissionMode = mode
		var appErr *AppError
		if _, err := s.CreateCloudAgentRun("user", req, ""); !errors.As(err, &appErr) || appErr.Status != 400 {
			t.Fatalf("unsupported permission %q did not return 400: %v", mode, err)
		}
		if tools := cloudAgentTools(req); len(tools) != 0 {
			t.Fatalf("unsupported permission %q exposed tools", mode)
		}
		for _, tool := range []string{"generate_media", "image_layer_split", "canvas_apply_ops", "canvas_bind_storyboard_assets", "plan_update"} {
			if cloudAgentToolAllowed(req, tool) {
				t.Fatalf("unsupported permission %q allowed %s", mode, tool)
			}
		}
	}
	var tasks, orders int64
	if err := db.Model(&model.Task{}).Count(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.BillingOrder{}).Count(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if tasks != 0 || orders != 0 {
		t.Fatalf("rejected permission created tasks=%d orders=%d", tasks, orders)
	}
}

func TestCloudAgentRetiredPermissionCannotResumeEvenWithCurrentPolicy(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, args, "auto")
	state.Request.PermissionMode = "full_access"
	if err := cloudAgentSave(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Update("state_json", run.StateJSON).Error; err != nil {
		t.Fatal(err)
	}
	decoded, err := cloudAgentDecode(run)
	if err != nil || decoded.Request.PermissionMode != "full_access" {
		t.Fatalf("frozen permission was not preserved: %v", err)
	}
	if err := validateCloudAgentPolicySnapshot(decoded.Policy); err != nil {
		t.Fatalf("fixture must use the current policy: %v", err)
	}
	var appErr *AppError
	if _, err := cloudAgentDecodeForExecution(run); !errors.As(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("retired permission did not block execution with 409: %v", err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, err = s.repo.CloudAgent("user", run.ID)
	if err != nil || run.Status != "failed" {
		t.Fatalf("retired run did not stop: %+v %v", run, err)
	}
	var tasks, orders int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	db.Model(&model.BillingOrder{}).Where("capability = ?", "video").Count(&orders)
	if tasks != 0 || orders != 0 {
		t.Fatalf("retired run submitted media: tasks=%d orders=%d", tasks, orders)
	}
}

func TestCloudAgentRetiredPermissionHistoryCanContinueWithCurrentPermission(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	parent, state := agentMediaRun(t, s, args, "auto")
	state.Request.PermissionMode = "full_access"
	state.Fingerprint = cloudAgentFingerprint(state.Request, state.ParentID)
	if err := cloudAgentSave(parent, &state); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Updates(map[string]any{
		"status": "completed", "state_json": parent.StateJSON,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// Completed task inputs may be compacted; frozen execution remains the source.
	if err := db.Model(&model.Task{}).Where("id = ?", parent.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "input_json": "{}", "result_json": `{"text":"历史回复"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	historicalStateJSON := parent.StateJSON
	public, err := s.CloudAgentRun("user", parent.ID)
	if err != nil || public.PermissionMode != "full_access" || public.Status != "completed" {
		t.Fatalf("retired history became unreadable: %+v %v", public, err)
	}
	if _, err := s.CloudAgentRun("other", parent.ID); err == nil {
		t.Fatal("historical read bypassed ownership")
	}
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	req.Prompt, req.IdempotencyKey = "继续", "current-permission-child"
	child, err := s.CreateCloudAgentRun("user", req, parent.ID)
	if err != nil {
		t.Fatalf("could not continue with a supported permission: %v", err)
	}
	childRun, err := s.repo.CloudAgent("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	childState, err := cloudAgentDecodeForExecution(childRun)
	if err != nil || childState.Request.PermissionMode != "request_approval" || childState.ParentID != parent.ID {
		t.Fatalf("continuation did not use the current permission: %+v %v", childState.Request, err)
	}
	if len(childState.TextHistory) != 2 || childState.TextHistory[1].Content != "历史回复" {
		t.Fatal("continuation lost trusted historical context")
	}
	storedParent, err := s.repo.CloudAgent("user", parent.ID)
	if err != nil || storedParent.StateJSON != historicalStateJSON {
		t.Fatalf("continuation rewrote the frozen parent: %v", err)
	}
}
