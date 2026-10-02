package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestReferenceVideoConditionalDurationAdmissionAndRouting(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("lxmone-wan-videos", "wan30-720p")
	profile.Video.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 6, MaxWithReferenceVideo: 15}
	profile.Video.References.MaxVideos = 5
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateCapabilitySpec(spec); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, seconds string
		videos        int
		allowed       bool
	}{
		{"plain min", "4", 0, true}, {"plain max", "30", 0, true},
		{"below min", "3", 0, false}, {"above max", "31", 0, false},
		{"reference min", "4", 1, true}, {"reference max", "15", 1, true},
		{"reference excess", "16", 1, false}, {"reference thirty", "30", 5, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := canvasGenerationInput{Mode: "video", Prompt: "test", Config: providerConfig{VideoSeconds: tc.seconds}, ReferenceVideos: make([]providerMedia, tc.videos)}
			err := validateVideoTask(profile.Video, input)
			if (err == nil) != tc.allowed {
				t.Fatalf("admission error = %v, allowed %v", err, tc.allowed)
			}
			if tc.videos > 0 && !tc.allowed && (err == nil || !strings.Contains(err.Error(), "最长 15 秒")) {
				t.Fatalf("condition error = %v", err)
			}
			intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": tc.videos}, Options: map[string]any{"videoSeconds": tc.seconds}}
			if match := MatchCapability(spec, intent); match.Matched != tc.allowed {
				t.Fatalf("routing = %#v", match)
			}
		})
	}
}

func TestConditionalDurationConfigurationValidation(t *testing.T) {
	for _, tc := range []struct {
		name     string
		duration VideoDurationConfig
		allowed  bool
	}{
		{"range", VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 6, MaxWithReferenceVideo: 15}, true},
		{"absent", VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 6}, true},
		{"negative", VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 6, MaxWithReferenceVideo: -1}, false},
		{"below min", VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 6, MaxWithReferenceVideo: 3}, false},
		{"above max", VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 6, MaxWithReferenceVideo: 31}, false},
		{"enum", VideoDurationConfig{Selection: "enum", Values: []int{10, 20, 30}, Default: 30, MaxWithReferenceVideo: 15}, true},
		{"empty conditional enum", VideoDurationConfig{Selection: "enum", Values: []int{20, 30}, Default: 30, MaxWithReferenceVideo: 15}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateVideoDuration(tc.duration); (err == nil) != tc.allowed {
				t.Fatalf("validation = %v", err)
			}
		})
	}
}

func TestConditionalDurationSurvivesFixedPriceTiers(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("lxmone-wan-videos", "wan30-720p")
	profile.Video.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 30, Step: 1, Default: 6, MaxWithReferenceVideo: 15}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	spec = capabilitySpecWithPriceTiers(spec, model.ChannelModel{PriceTiers: []model.ChannelModelPriceTier{{Enabled: true, PriceConfigured: true, VideoSeconds: 30, Resolution: "*"}}})
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"videoSeconds": 30}}
	if !MatchCapability(spec, intent).Matched {
		t.Fatal("30-second price tier should allow no-reference input")
	}
	intent.Inputs = map[string]int{"video": 1}
	if MatchCapability(spec, intent).Matched {
		t.Fatal("price tier must not drop conditional duration limit")
	}
}
