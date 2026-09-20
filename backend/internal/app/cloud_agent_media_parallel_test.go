package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func agentParallelFixture(t *testing.T, count int, permission, mode string) (*Service, *gorm.DB, string) {
	t.Helper()
	s, db, args := agentMediaFixture(t)
	if mode == "image" {
		capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
		for _, row := range []any{
			&model.ChannelModel{ID: "image-cm", ChannelID: "channel", ModelKey: "grok-image", Capability: "image", Protocol: model.ChannelInterfaceGrokImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
			&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
		args.Mode, args.ChannelModelKey, args.Duration, args.VideoGenerateAudio = "image", "grok-image", 0, nil
		args.Size, args.Quality, args.ReferenceNodeIDs = "1:1", "2k", []string{"cat"}
	}
	run, state := agentMediaRun(t, s, args, permission)
	state.Request.Budget.MaxGenerationTasks, state.Request.Budget.MaxVideoSeconds = 0, 0
	state.Calls = nil
	for i := 0; i < count; i++ {
		args.NodeID, args.Title, args.SnapshotHash = fmt.Sprintf("parallel-%d", i), fmt.Sprintf("素材%d", i), ""
		call := agentMediaCall(args)
		call.ID = fmt.Sprintf("call-%d", i)
		if mode == "image" && i%2 == 1 {
			call.Function.Name = "image_layer_split"
		}
		state.Calls = append(state.Calls, call)
	}
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "tool_calls": state.Calls})
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	return s, db, run.ID
}

func advanceAgentParallel(t *testing.T, s *Service, runID string, steps int) {
	t.Helper()
	for i := 0; i < steps; i++ {
		if err := s.advanceCloudAgentByID("user", runID); err != nil {
			t.Fatal(err)
		}
	}
}

func agentParallelTasks(t *testing.T, s *Service, runID string) []model.Task {
	t.Helper()
	children, err := s.repo.CloudAgentChildTasks("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	media := []model.Task{}
	for _, task := range children {
		if task.Type == "canvas_image" || task.Type == "canvas_video" {
			media = append(media, task)
		}
	}
	return media
}

func completeParallelTask(t *testing.T, db *gorm.DB, task model.Task, mode string) {
	t.Helper()
	resourceID := "output-" + task.ID
	mime := "video/mp4"
	if mode == "image" {
		mime = "image/png"
	}
	if err := db.Create(&model.Resource{ID: resourceID, UserID: "user", Kind: mode, Status: "ready", MimeType: mime, Width: 640, Height: 480}).Error; err != nil {
		t.Fatal(err)
	}
	result := map[string]any{"mode": mode, mode: map[string]any{"storageKey": "resource:" + resourceID}}
	if mode == "image" {
		result["images"] = []any{result[mode]}
		delete(result, mode)
	}
	raw, _ := json.Marshal(result)
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentParallelMediaCapacityRecoveryAndResults(t *testing.T) {
	for _, mode := range []string{"image", "video"} {
		t.Run(mode, func(t *testing.T) {
			s, db, id := agentParallelFixture(t, 5, "full_access", mode)
			advanceAgentParallel(t, s, id, 18)
			tasks := agentParallelTasks(t, s, id)
			if len(tasks) != 4 {
				t.Fatalf("expected four concurrent tasks before any completion, got %d", len(tasks))
			}
			run, state := agentInterjectionState(t, s, id)
			if run.Status != "running" || len(state.PendingMedia) != 3 || state.ActiveTaskID != "" {
				t.Fatalf("invalid parallel checkpoint: %s", run.StateJSON)
			}
			if _, err := cloudAgentDecodeForExecution(run); err != nil {
				t.Fatal(err)
			}
			// Complete an earlier call out of order. Recovery must bind its result
			// to that call and refill the freed slot without resubmitting the rest.
			completeParallelTask(t, db, tasks[1], mode)
			advanceAgentParallel(t, s, id, 5)
			tasks = agentParallelTasks(t, s, id)
			if len(tasks) != 5 {
				t.Fatalf("freed slot was not refilled: %d", len(tasks))
			}
			for i, task := range tasks {
				if i == 1 {
					continue
				}
				completeParallelTask(t, db, task, mode)
			}
			advanceAgentParallel(t, s, id, 4)
			_, state = agentInterjectionState(t, s, id)
			if len(state.PendingMedia) != 0 || state.MediaTaskID != "" || state.CallIndex != 5 || state.ActiveTaskID != "" {
				t.Fatal("did not settle all media before next model step")
			}
			canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil {
				t.Fatal(err)
			}
			doc, _ := creationDocument(canvas.PayloadJSON)
			nodes, _ := creationObjects(doc["nodes"])
			results := map[string]int{}
			for _, event := range state.Events {
				if event.Type == "tool_completed" || event.Type == "tool_failed" {
					results[stringValue(event.Payload["callId"])]++
				}
			}
			for i, task := range tasks {
				meta := nodes[fmt.Sprintf("parallel-%d", i)]["metadata"].(map[string]any)
				if meta["status"] != "success" || meta["storageKey"] != "resource:output-"+task.ID || results[fmt.Sprintf("call-%d", i)] != 1 {
					t.Fatalf("result crossed nodes or duplicated: %d %+v %+v", i, meta, results)
				}
			}
			if !state.Canonical.ParallelToolCalls || canonicalAgentChatBody(&state.Canonical, false)["parallel_tool_calls"] != true || canonicalAgentResponsesBody(&state.Canonical)["parallel_tool_calls"] != true {
				t.Fatal("upstream still disables parallel calls")
			}
		})
	}
}

func TestCloudAgentParallelMediaApprovalKeepsCollecting(t *testing.T) {
	s, db, id := agentParallelFixture(t, 2, "auto", "video")
	advanceAgentParallel(t, s, id, 1)
	approveAgentMediaDraft(t, s, id)
	advanceAgentParallel(t, s, id, 2)
	run, state := agentInterjectionState(t, s, id)
	if run.Status != "waiting_approval" || len(state.PendingMedia) != 1 || state.Approval == nil {
		t.Fatal("next approval did not overlap first generation")
	}
	approvalID := state.Approval.ID
	tasks := agentParallelTasks(t, s, id)
	if len(tasks) != 1 {
		t.Fatal("unapproved task was charged")
	}
	completeParallelTask(t, db, tasks[0], "video")
	active, err := s.repo.ActiveCloudAgentsAfter("", 50)
	if err != nil || len(active) != 1 {
		t.Fatalf("waiting approval with live media omitted by scheduler: %v %d", err, len(active))
	}
	advanceAgentParallel(t, s, id, 1)
	run, state = agentInterjectionState(t, s, id)
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID != approvalID || state.Approval.Decision != "" || len(state.PendingMedia) != 0 {
		t.Fatal("completion consumed the next approval")
	}
	approveAgentMediaDraft(t, s, id)
	if len(agentParallelTasks(t, s, id)) != 2 {
		t.Fatal("approved second task did not submit")
	}
}

func TestCloudAgentParallelMediaCancellationIncludesAllChildren(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(fmt.Sprint(corrupt), func(t *testing.T) {
			s, db, id := agentParallelFixture(t, 4, "full_access", "video")
			advanceAgentParallel(t, s, id, 14)
			if len(agentParallelTasks(t, s, id)) != 4 {
				t.Fatal("missing concurrent tasks")
			}
			if corrupt {
				if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", id).Update("state_json", "{").Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := s.CancelCloudAgent(context.Background(), "user", id); err != nil {
				t.Fatal(err)
			}
			run, err := s.repo.CloudAgent("user", id)
			if err != nil || run.Status != "cancelled" || run.CleanupPending || run.MediaTaskID != "" {
				t.Fatalf("cleanup incomplete: %+v %v", run, err)
			}
			for _, task := range agentParallelTasks(t, s, id) {
				if task.Status != model.TaskStatusCancelled {
					t.Fatalf("orphaned billed task: %s %s", task.ID, task.Status)
				}
			}
			canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
			doc, _ := creationDocument(canvas.PayloadJSON)
			nodes, _ := creationObjects(doc["nodes"])
			for i := 0; i < 4; i++ {
				if nodes[fmt.Sprintf("parallel-%d", i)]["metadata"].(map[string]any)["status"] == "loading" {
					t.Fatal("cancelled node still loading")
				}
			}
		})
	}
}

func TestCloudAgentParallelMediaDependenciesWait(t *testing.T) {
	for _, dependency := range []string{"target", "reference", "non_media"} {
		t.Run(dependency, func(t *testing.T) {
			s, db, id := agentParallelFixture(t, 2, "full_access", "image")
			run, state := agentInterjectionState(t, s, id)
			args, _ := cloudAgentParallelMediaArgs(state.Calls[1])
			switch dependency {
			case "target":
				args.NodeID = "parallel-0"
			case "reference":
				args.ReferenceNodeIDs = []string{"parallel-0"}
			case "non_media":
				state.Calls[1].Function.Name = "canvas_get_state"
			}
			raw, _ := json.Marshal(args)
			state.Calls[1].Function.Arguments = string(raw)
			if err := s.repo.MutateCloudAgent("user", id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			advanceAgentParallel(t, s, id, 10)
			run, state = agentInterjectionState(t, s, id)
			if len(agentParallelTasks(t, s, id)) != 1 || state.CallIndex != 0 || len(state.PendingMedia) != 0 || run.Status != "running" {
				t.Fatal("dependent call ran before its input settled")
			}
			if dependency == "reference" {
				completeParallelTask(t, db, agentParallelTasks(t, s, id)[0], "image")
				advanceAgentParallel(t, s, id, 3)
				if len(agentParallelTasks(t, s, id)) != 2 {
					t.Fatal("dependent call did not resume after its reference was ready")
				}
			}
		})
	}
}

func TestCloudAgentParallelMediaBudgetsIncludeInFlightTasks(t *testing.T) {
	for _, budget := range []string{"count", "seconds", "credits"} {
		t.Run(budget, func(t *testing.T) {
			s, _, id := agentParallelFixture(t, 3, "full_access", "video")
			advanceAgentParallel(t, s, id, 5)
			if len(agentParallelTasks(t, s, id)) != 2 {
				t.Fatal("expected two in-flight reservations")
			}
			run, state := agentInterjectionState(t, s, id)
			switch budget {
			case "count":
				state.Request.Budget.MaxGenerationTasks = 2
			case "seconds":
				state.Request.Budget.MaxVideoSeconds = 24
			case "credits":
				orders, err := s.repo.BillingOrdersByTaskIDs("user", state.TaskIDs)
				if err != nil {
					t.Fatal(err)
				}
				var total int64
				for _, order := range orders {
					total += order.AmountMicrocredits
				}
				state.Request.Budget.MaxCredits = float64(total) / float64(CreditScale)
			}
			if err := s.repo.MutateCloudAgent("user", id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			advanceAgentParallel(t, s, id, 5)
			if len(agentParallelTasks(t, s, id)) != 2 {
				t.Fatal("parallel submission exceeded aggregate budget")
			}
			_, state = agentInterjectionState(t, s, id)
			if state.ActiveTaskID != "" {
				t.Fatal("next model step began before outstanding media settled")
			}
		})
	}
}

func TestCloudAgentParallelMediaConcurrentAdmissionUsesOneReservation(t *testing.T) {
	s, _, id := agentParallelFixture(t, 2, "full_access", "video")
	advanceAgentParallel(t, s, id, 4)
	run, first := agentInterjectionState(t, s, id)
	_, second := agentInterjectionState(t, s, id)
	if first.Approval == nil || first.CallIndex != 1 {
		t.Fatal("second call is not prepared")
	}
	if err := s.advanceCloudAgentTool(run, &first); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentTool(run, &second); !errors.Is(err, repository.ErrCreationConflict) {
		t.Fatalf("stale worker was not fenced: %v", err)
	}
	tasks := agentParallelTasks(t, s, id)
	if len(tasks) != 2 {
		t.Fatalf("stale worker duplicated task: %d", len(tasks))
	}
	ids := []string{tasks[0].ID, tasks[1].ID}
	orders, err := s.repo.BillingOrdersByTaskIDs("user", ids)
	if err != nil || len(orders) != 2 {
		t.Fatalf("duplicate reservation: %v %+v", err, orders)
	}
}

func TestCloudAgentParallelMediaFailureDoesNotRetryOrLoseSiblings(t *testing.T) {
	s, db, id := agentParallelFixture(t, 3, "full_access", "video")
	advanceAgentParallel(t, s, id, 9)
	tasks := agentParallelTasks(t, s, id)
	if len(tasks) != 3 {
		t.Fatal("missing parallel media")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", tasks[1].ID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "上游失败"}).Error; err != nil {
		t.Fatal(err)
	}
	advanceAgentParallel(t, s, id, 1)
	run, state := agentInterjectionState(t, s, id)
	if run.Status != "running" || len(state.PendingMedia) != 1 || state.MediaTaskID != tasks[2].ID {
		t.Fatal("one failure discarded the other tasks")
	}
	completeParallelTask(t, db, tasks[2], "video")
	completeParallelTask(t, db, tasks[0], "video")
	advanceAgentParallel(t, s, id, 2)
	run, state = agentInterjectionState(t, s, id)
	if run.Status != "running" || len(state.PendingMedia) != 0 || state.MediaTaskID != "" || len(agentParallelTasks(t, s, id)) != 3 {
		t.Fatal("failed generation was retried or siblings did not settle")
	}
	failed := 0
	for _, event := range state.Events {
		if event.Type == "tool_failed" && event.Payload["callId"] == "call-1" {
			failed++
		}
	}
	if failed != 1 {
		t.Fatal("generation error did not return exactly once to the model")
	}
}

func TestCloudAgentParallelMediaSnapshotChainIncludesCompletions(t *testing.T) {
	for _, mediaHash := range []bool{false, true} {
		t.Run(fmt.Sprint(mediaHash), func(t *testing.T) {
			s, db, id := agentParallelFixture(t, 3, "full_access", "video")
			canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil {
				t.Fatal(err)
			}
			doc, _ := creationDocument(canvas.PayloadJSON)
			baseline := cloudAgentCanvasHash(doc)
			if mediaHash {
				baseline = cloudAgentMediaContentHash(doc)
			}
			run, state := agentInterjectionState(t, s, id)
			state.StepSnapshotHash = baseline
			for i, call := range state.Calls {
				state.Calls[i] = cloudAgentRewriteCallSnapshotHash(call, baseline)
			}
			if err := s.repo.MutateCloudAgent("user", id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			advanceAgentParallel(t, s, id, 5)
			tasks := agentParallelTasks(t, s, id)
			if len(tasks) != 2 {
				t.Fatalf("shared snapshot blocked sibling submission: %d", len(tasks))
			}
			completeParallelTask(t, db, tasks[0], "video")
			advanceAgentParallel(t, s, id, 4)
			if len(agentParallelTasks(t, s, id)) != 3 {
				t.Fatal("own completion invalidated next independent call")
			}
		})
	}
}

func TestCloudAgentParallelMediaWritebackFailureCleansUpSiblings(t *testing.T) {
	s, db, id := agentParallelFixture(t, 3, "full_access", "video")
	advanceAgentParallel(t, s, id, 9)
	tasks := agentParallelTasks(t, s, id)
	if len(tasks) != 3 {
		t.Fatal("missing parallel tasks")
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes := []map[string]any{}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != "parallel-0" {
			nodes = append(nodes, node)
		}
	}
	doc["nodes"] = nodes
	raw, _ := json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", tasks[0].ID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "上游失败"}).Error; err != nil {
		t.Fatal(err)
	}
	// A foreign account using the same run selector is never a cleanup target.
	if err := db.Create(&model.Task{ID: "foreign-task", UserID: "other", AgentRunID: id, Type: "canvas_video", Status: model.TaskStatusQueued, InputJSON: "{}"}).Error; err != nil {
		t.Fatal(err)
	}
	advanceAgentParallel(t, s, id, 1)
	run, _ := s.repo.CloudAgent("user", id)
	if run.Status != "failed" || !run.CleanupPending {
		t.Fatal("writeback failure did not hand off sibling cleanup")
	}
	advanceAgentParallel(t, s, id, 1)
	run, _ = s.repo.CloudAgent("user", id)
	if run.CleanupPending {
		t.Fatal("sibling cleanup did not finish")
	}
	for _, task := range agentParallelTasks(t, s, id) {
		if !cloudAgentTaskTerminal(task.Status) {
			t.Fatal("orphaned sibling after writeback failure")
		}
	}
	foreign, err := s.repo.TaskForUser("other", "foreign-task")
	if err != nil || foreign.Status != model.TaskStatusQueued {
		t.Fatal("cleanup crossed account ownership")
	}
}
