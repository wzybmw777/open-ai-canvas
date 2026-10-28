package database

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestMigrateQTRaderH3NativeAudio(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	rows := []model.ChannelModel{
		{ID: "h3-hd", ChannelID: "qt", ModelKey: "h3-video-hd", ProviderModelKey: "h3-video", Capability: "video", Protocol: "qtrader-h3", CapabilityConfigJSON: `{"version":1,"video":{"generateAudio":{"supported":false,"default":false}}}`},
		{ID: "h3-frames", ChannelID: "qt", ModelKey: "h3-video-frames", ProviderModelKey: "h3-video-frames", Capability: "video", Protocol: "qtrader-h3", CapabilityConfigJSON: `{"version":1,"video":{"generateAudio":{"supported":false,"default":true}}}`},
		{ID: "h3-long", ChannelID: "qt", ModelKey: "h3-video", ProviderModelKey: "h3-video", Capability: "video", Protocol: "qtrader-h3", CapabilityConfigJSON: `{"version":1,"video":{"generateAudio":{"supported":true,"default":true}}}`},
		{ID: "other", ChannelID: "other", ModelKey: "h3-video-frames", ProviderModelKey: "h3-video-frames", Capability: "video", Protocol: "other", CapabilityConfigJSON: `{"version":1,"video":{"generateAudio":{"supported":false,"default":false}}}`},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrateQTRaderH3NativeAudio(db); err != nil {
		t.Fatal(err)
	}

	var updated, unchanged model.ChannelModel
	if err := db.First(&updated, "id = ?", "h3-hd").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&unchanged, "id = ?", "other").Error; err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(updated.CapabilityConfigJSON), &config); err != nil {
		t.Fatal(err)
	}
	video := config["video"].(map[string]any)
	audio := video["generateAudio"].(map[string]any)
	if audio["supported"] != true || audio["default"] != true {
		t.Fatalf("H3 audio capability = %#v, want supported/default true", audio)
	}
	if unchanged.CapabilityConfigJSON != rows[3].CapabilityConfigJSON {
		t.Fatalf("unrelated model changed: %s", unchanged.CapabilityConfigJSON)
	}
}
