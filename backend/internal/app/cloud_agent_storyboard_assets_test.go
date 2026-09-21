package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func agentStoryboardBindingsFixture(t *testing.T) (*Service, *gorm.DB, *model.CanvasProject, []map[string]any) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	rows := createCloudAgentStoryboardForTest(t, s, canvas)
	return s, db, canvas, rows
}

func storyboardBinding(nodeID, role string, priority int) map[string]any {
	return map[string]any{"nodeId": nodeID, "role": role, "priority": priority}
}

func storyboardBindingsArgs(canvas *model.CanvasProject, rows []map[string]any) map[string]any {
	doc, _ := creationDocument(canvas.PayloadJSON)
	return map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "nodeId": "storyboard-1", "mode": "merge", "rows": []any{
		map[string]any{"rowId": rows[0]["id"], "assetBindings": []any{storyboardBinding("hero", "character", 100)}},
		map[string]any{"rowId": rows[1]["id"], "assetBindings": []any{storyboardBinding("cat", "prop", 80)}},
	}}
}

func TestCloudAgentStoryboardBindingsModesPersistAndUndo(t *testing.T) {
	for _, mode := range []string{"read_only", "request_approval", "auto", "full_access"} {
		t.Run(mode, func(t *testing.T) {
			s, db, canvas, rows := agentStoryboardBindingsFixture(t)
			args := storyboardBindingsArgs(canvas, rows)
			call := cloudAgentStoryboardCall(t, "canvas_bind_storyboard_assets", "bind-assets", args)
			req := agentTestRequest()
			req.PermissionMode = mode
			root, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			run, state := agentInterjectionState(t, s, root.ID)
			state.ActiveTaskID, state.Calls, state.CallIndex = "", []cloudAgentCall{call}, 0
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			var tasksBefore, ordersBefore int64
			db.Model(&model.Task{}).Count(&tasksBefore)
			db.Model(&model.BillingOrder{}).Count(&ordersBefore)
			advanceAgentParallel(t, s, run.ID, 1)
			if mode == "request_approval" {
				waiting, err := s.CloudAgentRun("user", run.ID)
				if err != nil || waiting.Approval == nil || waiting.Status != "waiting_approval" || len(waiting.Approval.Preview.Items) != 2 {
					t.Fatalf("missing binding approval: %+v %v", waiting, err)
				}
				stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
				if stored.PayloadJSON != canvas.PayloadJSON {
					t.Fatal("binding written before approval")
				}
				if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
					t.Fatal(err)
				}
				advanceAgentParallel(t, s, run.ID, 1)
			}
			stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
			_, state = agentInterjectionState(t, s, run.ID)
			if mode == "read_only" {
				if stored.PayloadJSON != canvas.PayloadJSON || state.Events[len(state.Events)-1].Type != "tool_failed" {
					t.Fatal("read-only run gained binding authority")
				}
				return
			}
			doc, _ := creationDocument(stored.PayloadJSON)
			_, _, bound, err := storyboardNodeFromDocument(doc, "storyboard-1")
			if err != nil {
				t.Fatal(err)
			}
			for i, nodeID := range []string{"hero", "cat"} {
				bindings := creationMaps(bound[i]["assetBindings"])
				if len(bindings) != 1 || bindings[0]["nodeId"] != nodeID {
					t.Fatalf("wrong row binding: %+v", bound)
				}
				for key, value := range rows[i] {
					if key != "assetBindings" && !reflect.DeepEqual(value, bound[i][key]) {
						t.Fatalf("association changed protected row field %s", key)
					}
				}
			}
			var tasksAfter, ordersAfter int64
			db.Model(&model.Task{}).Count(&tasksAfter)
			db.Model(&model.BillingOrder{}).Count(&ordersAfter)
			if tasksBefore != tasksAfter || ordersBefore != ordersAfter {
				t.Fatal("binding unexpectedly generated or billed media")
			}
			patch := agentCanvasPatchForOperation(t, state, call.Function.Name)
			if patch["status"] != "applied" || patch["text"] != "画布修改已保存" {
				t.Fatal("saved binding misreported as pending")
			}
			if _, err := s.UndoCloudAgentCanvas("user", run.ID, call.ID, cloudAgentCanvasHash(doc), "撤销关联"); err != nil {
				t.Fatal(err)
			}
			restored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
			if restored.PayloadJSON != canvas.PayloadJSON {
				t.Fatal("undo did not restore original storyboard")
			}
		})
	}
}

func TestCloudAgentStoryboardBindingsMergeReplaceAndRead(t *testing.T) {
	s, _, canvas, rows := agentStoryboardBindingsFixture(t)
	policy, _ := s.RuntimePolicy()
	args := storyboardBindingsArgs(canvas, rows)
	apply := func() {
		t.Helper()
		call := cloudAgentStoryboardCall(t, "canvas_bind_storyboard_assets", "bind", args)
		if _, err := applyCloudAgentStoryboardMutation(s.repo, "user", canvas.ID, call, policy); err != nil {
			t.Fatal(err)
		}
		canvas, _ = s.repo.CanvasProjectForUser("user", canvas.ID)
		doc, _ := creationDocument(canvas.PayloadJSON)
		args["snapshotHash"] = cloudAgentCanvasHash(doc)
	}
	apply()
	args["rows"] = []any{map[string]any{"rowId": rows[0]["id"], "assetBindings": []any{storyboardBinding("cat", "environment", 90)}}}
	apply()
	apply()
	doc, _ := creationDocument(canvas.PayloadJSON)
	_, _, bound, _ := storyboardNodeFromDocument(doc, "storyboard-1")
	bindings := creationMaps(bound[0]["assetBindings"])
	if len(bindings) != 2 || bindings[0]["nodeId"] != "hero" || bindings[1]["nodeId"] != "cat" {
		t.Fatal("merge dropped existing assets or duplicated repeated binding")
	}
	view, err := cloudAgentCanvasState(s.repo, "user", canvas.ID, doc, 0, []string{"storyboard-1"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	read, err := cloudAgentStoryboardReadResult(view, "storyboard-1")
	if err != nil {
		t.Fatal(err)
	}
	readRows := creationMaps(read["storyboard"].(map[string]any)["rows"])
	if len(creationMaps(readRows[0]["assetBindings"])) != 2 {
		t.Fatal("binding not discoverable through real Agent read tool")
	}
	args["mode"] = "replace"
	args["rows"] = []any{map[string]any{"rowId": rows[0]["id"], "assetBindings": []any{}}}
	apply()
	doc, _ = creationDocument(canvas.PayloadJSON)
	_, _, bound, _ = storyboardNodeFromDocument(doc, "storyboard-1")
	if len(creationMaps(bound[0]["assetBindings"])) != 0 || len(creationMaps(bound[1]["assetBindings"])) != 1 {
		t.Fatal("replace clear affected the wrong row")
	}
}

func TestCloudAgentStoryboardBindingsRejectUnsafeWritesAtomically(t *testing.T) {
	for _, change := range []string{"canvas_owner", "missing_row", "duplicate_row", "foreign_resource", "unready_resource", "missing_asset", "text_asset", "locked", "snapshot", "role", "priority", "fractional_priority", "missing_bindings", "null_bindings", "duplicate_binding", "unknown_binding_field", "protected_row_field", "too_many_rows", "too_many_bindings"} {
		t.Run(change, func(t *testing.T) {
			s, db, canvas, rows := agentStoryboardBindingsFixture(t)
			args := storyboardBindingsArgs(canvas, rows)
			updates := args["rows"].([]any)
			second := updates[1].(map[string]any)
			binding := second["assetBindings"].([]any)[0].(map[string]any)
			userID := "user"
			switch change {
			case "canvas_owner":
				userID = "other"
			case "missing_row":
				second["rowId"] = "unknown"
			case "duplicate_row":
				second["rowId"] = rows[0]["id"]
			case "foreign_resource":
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-two").Update("user_id", "other").Error; err != nil {
					t.Fatal(err)
				}
			case "unready_resource":
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-two").Update("status", "pending").Error; err != nil {
					t.Fatal(err)
				}
			case "missing_asset":
				binding["nodeId"] = "missing"
			case "text_asset":
				binding["nodeId"] = "shot-1"
			case "locked":
				doc, _ := creationDocument(canvas.PayloadJSON)
				node, _, _, _ := storyboardNodeFromDocument(doc, "storyboard-1")
				node["metadata"].(map[string]any)["locked"] = true
				raw, _ := json.Marshal(doc)
				canvas.PayloadJSON = string(raw)
				if err := db.Model(canvas).Update("payload_json", canvas.PayloadJSON).Error; err != nil {
					t.Fatal(err)
				}
				args["snapshotHash"] = cloudAgentCanvasHash(doc)
			case "snapshot":
				args["snapshotHash"] = strings.Repeat("0", 64)
			case "role":
				binding["role"] = "unknown"
			case "priority":
				binding["priority"] = 101
			case "fractional_priority":
				binding["priority"] = 1.5
			case "missing_bindings":
				delete(second, "assetBindings")
			case "null_bindings":
				second["assetBindings"] = nil
			case "duplicate_binding":
				second["assetBindings"] = []any{binding, binding}
			case "unknown_binding_field":
				binding["url"] = "https://invalid.example/asset"
			case "protected_row_field":
				second["imageNodeId"] = "forged"
			case "too_many_rows":
				for i := 0; i < 20; i++ {
					updates = append(updates, second)
				}
				args["rows"] = updates
			case "too_many_bindings":
				values := []any{}
				for i := 0; i < 17; i++ {
					values = append(values, binding)
				}
				second["assetBindings"] = values
			}
			call := cloudAgentStoryboardCall(t, "canvas_bind_storyboard_assets", "bad-bind", args)
			policy, _ := s.RuntimePolicy()
			if _, err := applyCloudAgentStoryboardMutation(s.repo, userID, canvas.ID, call, policy); err == nil {
				t.Fatal("unsafe binding accepted")
			}
			stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
			if stored.PayloadJSON != canvas.PayloadJSON {
				t.Fatal("part of rejected batch was persisted")
			}
		})
	}
}

func TestCloudAgentStoryboardBindingsRecheckOwnershipAfterApproval(t *testing.T) {
	s, db, canvas, rows := agentStoryboardBindingsFixture(t)
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	call := cloudAgentStoryboardCall(t, "canvas_bind_storyboard_assets", "bind-assets", storyboardBindingsArgs(canvas, rows))
	state.ActiveTaskID, state.Calls, state.CallIndex = "", []cloudAgentCall{call}, 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	advanceAgentParallel(t, s, run.ID, 1)
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatal("missing approval")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-two").Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	advanceAgentParallel(t, s, run.ID, 1)
	stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
	if stored.PayloadJSON != canvas.PayloadJSON {
		t.Fatal("approval bypassed changed resource ownership")
	}
}
