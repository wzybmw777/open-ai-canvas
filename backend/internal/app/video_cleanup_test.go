package app

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestVideoCleanupAdmissionOwnershipAndBilling(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example")
	profile := DefaultModelCapabilityConfigForModel("dashscope-happyhorse-video-edit", "happyhorse-1.0-video-edit")
	s, db, channel, sku := createSystemChannelSelectionFixture(t, "video", "dashscope-happyhorse-video-edit", profile, []model.ChannelModelPriceTier{newSelectionPriceTier("edit-tier", "{}", "happyhorse-1.0-video-edit", "per_second")})
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s.dataDir = t.TempDir()
	features := platform.DefaultFeatureAvailability()
	features.VideoWorkbenchEnabled = true
	if _, err := s.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, features); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "user", AvailableMicrocredits: 1000}).Error; err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "source.mp4")
	if output, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=white:s=640x360:r=24", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", file).CombinedOutput(); err != nil {
		t.Fatalf("fixture: %v %s", err, output)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	store := func(owner string, payload []byte) string {
		r, _, err := s.storeResource(owner, "video", "source.mp4", "video/mp4", int64(len(payload)), 1, 1, 60000, bytes.NewReader(payload), nil, false)
		if err != nil {
			t.Fatal(err)
		}
		return r.ID
	}
	foreign := store("other", data)
	corrupt := store("user", []byte("not a video"))
	for _, id := range []string{"", foreign, corrupt} {
		if _, err := s.CreateVideoCleanupTask("user", VideoCleanupRequest{ResourceID: id, Model: sku.ModelKey, ChannelID: channel.ID}, "", ""); err == nil {
			t.Fatalf("invalid input accepted: %q", id)
		}
	}
	var tasks int64
	db.Model(&model.Task{}).Count(&tasks)
	if tasks != 0 {
		t.Fatal("invalid input created task")
	}
	source := store("user", data)
	req := VideoCleanupRequest{ResourceID: source, Model: sku.ModelKey, ChannelID: channel.ID, Resolution: "720P"}
	task, err := s.CreateVideoCleanupTask("user", req, "trace", "request")
	if err != nil {
		t.Fatal(err)
	}
	if task.Type != "canvas_video" || task.Operation != "video_edit" || task.WorkbenchKind != WorkbenchKindVideo || task.BillingOrderID == "" {
		t.Fatalf("task=%#v", task)
	}
	if summary := taskSummaryForOutput(*task); summary.ClientContext == nil || !summary.ClientContext.VideoCleanup || summary.ClientContext.ImageCleanup {
		t.Fatalf("summary=%#v", summary)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		Config struct {
			Seconds   string `json:"videoSeconds"`
			Watermark string `json:"videoWatermark"`
		} `json:"config"`
		Videos []struct {
			Width      int   `json:"width"`
			DurationMs int64 `json:"durationMs"`
		} `json:"referenceVideos"`
	}
	if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input.Config.Seconds != "3" || input.Config.Watermark != "false" || len(input.Videos) != 1 || input.Videos[0].Width != 640 || input.Videos[0].DurationMs != 3000 {
		t.Fatalf("server input=%#v", input)
	}
	var account model.CreditAccount
	db.First(&account, "user_id = ?", "user")
	if account.ReservedMicrocredits <= 0 {
		t.Fatal("platform model charge not reserved")
	}
	profile.Video.Operations = []string{"text_to_video"}
	profile.Video.DefaultOperation = "text_to_video"
	encoded, _ := json.Marshal(profile)
	db.Model(&model.ChannelModel{}).Where("id = ?", sku.ID).Update("capability_config_json", string(encoded))
	if _, err := s.CreateVideoCleanupTask("user", req, "", ""); err == nil {
		t.Fatal("generation-only model accepted")
	}
	if _, err := s.CreateVideoCleanupTask("", req, "", ""); err == nil {
		t.Fatal("anonymous accepted")
	}
}
