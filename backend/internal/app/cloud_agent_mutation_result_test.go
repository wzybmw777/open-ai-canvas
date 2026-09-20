package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentMutationResultReportsSavedChanges(t *testing.T) {
	for _, tool := range []string{"canvas_apply_ops", "canvas_create_storyboard", "canvas_edit_storyboard", "canvas_edit_batch_table"} {
		for _, mode := range []string{"auto", "request_approval"} {
			t.Run(tool+"/"+mode, func(t *testing.T) {
				var s *Service
				var canvas *model.CanvasProject
				var args map[string]any
				if tool == "canvas_edit_batch_table" {
					s, canvas = cloudAgentBatchTableFixture(t)
					args = map[string]any{"nodeId": "batch-1", "action": "set_global_prompt", "globalPrompt": "updated prompt"}
				} else {
					s, canvas = cloudAgentStoryboardFixture(t)
					switch tool {
					case "canvas_apply_ops":
						args = map[string]any{"ops": []any{map[string]any{"type": "add_node", "id": "new-text", "nodeType": "text", "title": "Saved text"}}}
					case "canvas_create_storyboard":
						args = map[string]any{"nodeId": "new-storyboard", "title": "Saved storyboard", "rows": []any{map[string]any{"durationSeconds": 4, "plotDescription": "opening shot"}}}
					case "canvas_edit_storyboard":
						rows := createCloudAgentStoryboardForTest(t, s, canvas)
						args = map[string]any{"nodeId": "storyboard-1", "action": "update", "rowId": rows[0]["id"], "patch": map[string]any{"videoMotionPrompt": "camera moves forward"}}
					}
				}
				doc, _ := creationDocument(canvas.PayloadJSON)
				beforeHash := cloudAgentCanvasHash(doc)
				args["snapshotHash"] = beforeHash
				call := cloudAgentStoryboardCall(t, tool, "saved-mutation", args)
				req := agentTestRequest()
				req.CanvasID, req.PermissionMode = canvas.ID, mode
				root, err := s.CreateCloudAgentRun("user", req, "")
				if err != nil {
					t.Fatal(err)
				}
				run, _ := s.repo.CloudAgent("user", root.ID)
				state, _ := cloudAgentDecode(run)
				state.ActiveTaskID, state.CallIndex, state.Calls = "", 0, []cloudAgentCall{call}
				if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &state)
				}); err != nil {
					t.Fatal(err)
				}
				if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
					t.Fatal(err)
				}
				if mode == "request_approval" {
					waiting, err := s.CloudAgentRun("user", run.ID)
					if err != nil || waiting.Approval == nil || waiting.Status != "waiting_approval" {
						t.Fatalf("missing required approval: %+v %v", waiting, err)
					}
					stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
					if stored.PayloadJSON != canvas.PayloadJSON {
						t.Fatal("canvas changed before approval")
					}
					if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", "confirmed"); err != nil {
						t.Fatal(err)
					}
					if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
						t.Fatal(err)
					}
				}
				run, _ = s.repo.CloudAgent("user", run.ID)
				state, _ = cloudAgentDecode(run)
				if state.Approval != nil || state.CallIndex != 1 {
					t.Fatalf("completed write still waiting: %+v", state.Approval)
				}
				patch := agentCanvasPatchForOperation(t, state, tool)
				if patch["status"] != "applied" || patch["text"] != "画布修改已保存" {
					t.Fatalf("saved canvas event still describes pending approval: %+v", patch)
				}
				message := state.Canonical.Messages[len(state.Canonical.Messages)-1]
				var result map[string]any
				if err := json.Unmarshal([]byte(stringValue(message["content"])), &result); err != nil {
					t.Fatal(err)
				}
				if result["status"] != "applied" || result["preview"] != nil || len(creationMaps(result["changes"])) == 0 || !strings.Contains(stringValue(result["summary"]), "已保存") {
					t.Fatalf("write result misrepresents persisted changes: %+v", result)
				}
				stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
				after, _ := creationDocument(stored.PayloadJSON)
				if result["snapshotHash"] != cloudAgentCanvasHash(after) || result["snapshotHash"] == beforeHash {
					t.Fatal("success result does not match the persisted canvas")
				}
			})
		}
	}
}
