package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestQTCapabilityAuditNormalizesReviewedSnapshot(t *testing.T) {
	directory := os.Getenv("QT_CAPABILITY_TEST_BACKUP")
	if directory == "" {
		t.Skip("set QT_CAPABILITY_TEST_BACKUP to a capability audit backup")
	}
	read := func(name string, target any) {
		t.Helper()
		body, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(body, target); err != nil {
			t.Fatal(err)
		}
	}
	var snapshot struct {
		Models []struct {
			ID                   string `json:"id"`
			ModelKey             string `json:"model_key"`
			Protocol             string `json:"protocol"`
			Capability           string `json:"capability"`
			CapabilityConfigJSON string `json:"capability_config_json"`
		} `json:"models"`
	}
	var report struct {
		Changes []struct {
			ID    string `json:"id"`
			After string `json:"after"`
		} `json:"changes"`
	}
	read("before.json", &snapshot)
	read("report.json", &report)
	changes := make(map[string]string)
	for _, change := range report.Changes {
		changes[change.ID] = change.After
	}
	if len(snapshot.Models) == 0 || len(changes) == 0 {
		t.Fatal("audit fixture must contain models and actual changes")
	}
	for _, item := range snapshot.Models {
		t.Run(item.ModelKey, func(t *testing.T) {
			raw := item.CapabilityConfigJSON
			if changed := changes[item.ID]; changed != "" {
				raw = changed
			}
			profile, err := DecodeModelCapabilityConfig(raw)
			if err != nil {
				t.Fatal(err)
			}
			normalized, err := NormalizeModelCapabilityConfigForModel(item.Capability, item.Protocol, item.ModelKey, profile)
			if err != nil {
				t.Fatal(err)
			}
			if item.ModelKey != "wan30-720p" {
				return
			}
			input := canvasGenerationInput{Mode: "video", Prompt: "混合参考", Config: providerConfig{
				Model: item.ModelKey, InterfaceType: item.Protocol, VideoSeconds: "15", Size: "16:9", VQuality: "720p",
			}, Metadata: map[string]interface{}{"videoEditOperation": "reference_to_video"}}
			for i := 0; i < 10; i++ {
				input.ReferenceImages = append(input.ReferenceImages, providerMedia{})
			}
			for i := 0; i < 5; i++ {
				input.ReferenceVideos = append(input.ReferenceVideos, providerMedia{})
				input.ReferenceAudios = append(input.ReferenceAudios, providerMedia{})
			}
			if err := validateVideoTask(normalized.Video, input); err != nil {
				t.Fatal(err)
			}
			input.Config.VideoSeconds = "30"
			if err := validateVideoTask(normalized.Video, input); err == nil || !strings.Contains(err.Error(), "最长 15 秒") {
				t.Fatalf("reference video at 30 seconds must be rejected, got %v", err)
			}
			input.ReferenceVideos = nil
			if err := validateVideoTask(normalized.Video, input); err != nil {
				t.Fatalf("images and audio at 30 seconds must be accepted, got %v", err)
			}
		})
	}
}
