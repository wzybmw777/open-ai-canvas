package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func cleanupPNG(t *testing.T, fill color.Color) []byte {
	t.Helper()
	i := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			i.Set(x, y, fill)
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, i); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func cleanupResource(t *testing.T, s *Service, owner string, payload []byte) string {
	t.Helper()
	r, _, err := s.storeResource(owner, "image", "source.png", "image/png", int64(len(payload)), 8, 8, 0, bytes.NewReader(payload), nil, false)
	if err != nil {
		t.Fatal(err)
	}
	return r.ID
}
func enableCleanupFeature(t *testing.T, s *Service) {
	t.Helper()
	features := platform.DefaultFeatureAvailability()
	features.ImageWorkbenchEnabled = true
	features.WatermarkRemovalEnabled = true
	if _, err := s.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, features); err != nil {
		t.Fatal(err)
	}
}
func TestImageCleanupAdmissionAndOwnership(t *testing.T) {
	s, db := newTimelineTaskTestService(t)
	s.dataDir = t.TempDir()
	enableCleanupFeature(t, s)
	source := cleanupResource(t, s, "user", cleanupPNG(t, color.White))
	mask := cleanupResource(t, s, "user", cleanupPNG(t, color.Transparent))
	foreign := cleanupResource(t, s, "other", cleanupPNG(t, color.Transparent))
	for _, req := range []ImageCleanupRequest{{}, {ResourceID: source, MaskResourceID: source}, {ResourceID: source, MaskResourceID: foreign}, {ResourceID: foreign, MaskResourceID: mask}, {ResourceID: source, MaskResourceID: source, Model: "model"}} {
		req.Model, req.ChannelID = "model", "system-channel"
		if _, err := s.CreateImageCleanupTask("user", req, "", ""); err == nil {
			t.Fatalf("invalid request accepted: %#v", req)
		}
	}
	if _, err := s.CreateImageCleanupTask("", ImageCleanupRequest{ResourceID: source}, "", ""); err == nil {
		t.Fatal("anonymous accepted")
	}
	if _, err := s.CreateImageCleanupTask("user", ImageCleanupRequest{ResourceID: source, Model: "arbitrary-model"}, "", ""); err == nil {
		t.Fatal("unconfigured model accepted")
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 0 {
		t.Fatal("invalid input created tasks")
	}
}
func TestImageCleanupUsesExistingModelAndBilling(t *testing.T) {
	for _, masked := range []bool{false, true} {
		t.Run(map[bool]string{false: "reference", true: "mask"}[masked], func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-1")
			profile.Image.Size = ImageSizeConfig{Parameter: "size", Values: []string{"1024x1024"}, Default: "1024x1024", AllowCustom: true}
			s, db, channel, sku := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{newSelectionPriceTier("tier", "{}", "gpt-image-1", "fixed_request")})
			if err := db.AutoMigrate(database.Models()...); err != nil {
				t.Fatal(err)
			}
			s.dataDir = t.TempDir()
			enableCleanupFeature(t, s)
			if err := db.Create(&model.CreditAccount{UserID: "user", AvailableMicrocredits: 1000}).Error; err != nil {
				t.Fatal(err)
			}
			source := cleanupResource(t, s, "user", cleanupPNG(t, color.White))
			req := ImageCleanupRequest{ResourceID: source, Model: sku.ModelKey, ChannelID: channel.ID, Parameters: ImageCleanupParameters{Size: "1024x1024"}}
			if masked {
				req.MaskResourceID = cleanupResource(t, s, "user", cleanupPNG(t, color.Transparent))
			}
			task, err := s.CreateImageCleanupTask("user", req, "trace", "request")
			if err != nil {
				t.Fatal(err)
			}
			if task.Type != "canvas_image" || task.Operation != "image" || task.WorkbenchKind != WorkbenchKindImage || task.BillingOrderID == "" {
				t.Fatalf("unexpected task: %#v", task)
			}
			if summary := taskSummaryForOutput(*task); summary.ClientContext == nil || !summary.ClientContext.ImageCleanup {
				t.Fatal("history marker lost")
			}
			var input map[string]any
			stored, err := s.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			json.Unmarshal([]byte(stored.InputJSON), &input)
			if input["resourceId"] != source || input["maskResourceId"] != nil && !masked {
				t.Fatal("resource references changed")
			}
			if masked && input["mask"] == nil {
				t.Fatal("mask lost")
			}
			var account model.CreditAccount
			db.First(&account, "user_id = ?", "user")
			if account.ReservedMicrocredits <= 0 {
				t.Fatal("model charge not reserved")
			}
		})
	}
}
