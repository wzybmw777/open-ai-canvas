package app

import (
	"testing"

	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/sms"
)

func TestBundledSMSPluginsMatchHostProviders(t *testing.T) {
	manifests := bundledSMSPluginManifests()
	if len(manifests) != 3 {
		t.Fatalf("SMS plugin count = %d", len(manifests))
	}
	for _, manifest := range manifests {
		if err := protocol.ValidateManifest(manifest); err != nil {
			t.Fatal(err)
		}
		providers := manifest.Contributes.SMSProviders
		if len(providers) != 1 || sms.PluginID(providers[0].ID) != manifest.Metadata.ID || !isSystemSMSPluginID(manifest.Metadata.ID) || manifest.Metadata.Enabled {
			t.Fatalf("invalid SMS plugin: %#v", manifest)
		}
	}
}

func TestBundledSMSPluginLoadsFromSystemSource(t *testing.T) {
	t.Setenv("CANVAS_OFFICIAL_PLUGIN_DIR", t.TempDir())
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, plugin := range center.list() {
		if plugin.Manifest.ID != sms.PluginHuyi {
			continue
		}
		if plugin.Source != PluginOriginSystem || !plugin.Manifest.Trusted || plugin.Status != "disabled" {
			t.Fatalf("unexpected Huyi plugin: %#v", plugin.Manifest)
		}
		return
	}
	t.Fatal("Huyi system plugin missing")
}
