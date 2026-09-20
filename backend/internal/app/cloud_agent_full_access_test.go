package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentFullAccessSubmitsMediaWithoutApproval(t *testing.T) {
	for _, kind := range []string{"video", "image", "image_layer_split"} {
		t.Run(kind, func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			if kind != "video" {
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
				args.Size, args.Quality, args.NodeID = "1:1", "2k", "image-shot-1"
				args.ReferenceNodeIDs = []string{"cat"}
			}
			run, state := agentMediaRun(t, s, args, "full_access")
			if kind == "image_layer_split" {
				state.Calls[0].Function.Name = kind
				if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &state)
				}); err != nil {
					t.Fatal(err)
				}
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ = cloudAgentDecode(run)
			if run.Status != "running" || state.Approval == nil || state.Approval.Decision != "approve" || state.Approval.Prepared == nil {
				t.Fatalf("full access did not persist prepared authorization: %s", run.StateJSON)
			}
			approvalID := state.Approval.ID
			if state.DecisionPreparedHashes[approvalID] != state.Approval.Prepared.Hash {
				t.Fatal("authorization did not bind the prepared inputs")
			}
			public, err := s.CloudAgentRun("user", run.ID)
			if err != nil || public.Approval != nil || public.Status == "waiting_approval" {
				t.Fatalf("full access exposed an approval card: %+v %v", public, err)
			}
			for _, event := range state.Events {
				if event.Type == "approval_requested" {
					t.Fatal("full access requested manual approval")
				}
			}
			// Resume from the persisted preparation without a user decision.
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, err = cloudAgentDecodeForExecution(run)
			if err != nil || state.MediaTaskID == "" {
				t.Fatalf("generation was not submitted: %v %s", err, run.StateJSON)
			}
			task, err := s.repo.TaskForUser("user", state.MediaTaskID)
			if err != nil || task.ApprovalID != approvalID || task.GenerationID == "" || task.BillingOrderID == "" {
				t.Fatalf("generation lost authorization/billing: %+v %v", task, err)
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			var count int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_"+args.Mode).Count(&count)
			if count != 1 {
				t.Fatalf("resume submitted %d generation tasks", count)
			}
		})
	}
}

func TestCloudAgentFullAccessRetainsAdmissionChecks(t *testing.T) {
	for _, change := range []string{"reference_owner", "budget", "snapshot", "price"} {
		t.Run(change, func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, args, "full_access")
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ := cloudAgentDecode(run)
			switch change {
			case "reference_owner":
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
					t.Fatal(err)
				}
			case "budget":
				state.Request.Budget.MaxCredits = 0.000001
				if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &state)
				}); err != nil {
					t.Fatal(err)
				}
			case "snapshot":
				canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
				doc, _ := creationDocument(canvas.PayloadJSON)
				nodes, _ := creationObjects(doc["nodes"])
				nodes[args.NodeID]["metadata"].(map[string]any)["composerContent"] = "changed prompt"
				raw, _ := json.Marshal(doc)
				if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
					t.Fatal(err)
				}
			case "price":
				if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "video-tier").Update("unit_price_microcredits", 2).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			var tasks, orders int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
			db.Model(&model.BillingOrder{}).Where("capability = ?", "video").Count(&orders)
			if tasks != 0 || orders != 0 {
				t.Fatalf("%s bypassed admission: tasks=%d orders=%d", change, tasks, orders)
			}
		})
	}
}
