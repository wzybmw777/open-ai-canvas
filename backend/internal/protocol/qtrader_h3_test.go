package protocol

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func qtraderH3Adapter(t *testing.T) Adapter {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "qtrader-h3", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(raw, nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("load H3: %v, count %d", err, len(adapters))
	}
	return adapters[0]
}

func TestQtraderH3MultipartAndSize(t *testing.T) {
	adapter := qtraderH3Adapter(t)
	for _, tc := range []struct{ resolution, ratio, size string }{
		{"480p", "16:9", "854x480"}, {"720p", "9:16", "720x1280"},
		{"768p", "16:9", "1366x768"}, {"960p", "4:3", "1280x960"},
		{"1080p", "21:9", "2520x1080"},
	} {
		request := GenerationRequest{Model: "h3-video", Prompt: "a clip", Duration: 6, Resolution: tc.resolution, AspectRatio: tc.ratio,
			Images: []MediaReference{{URL: "https://cdn.example/a.png", Role: "reference_image", Order: 2}, {URL: "https://cdn.example/b.png", Role: "reference_image", Order: 1}}}
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if spec.Path != "/v1/videos" || spec.ContentType != "multipart/form-data" || body["size"] != tc.size || body["seconds"] != "6" || body["optimize_prompt"] != false {
			t.Fatalf("invalid H3 request: %#v, %#v", spec, body)
		}
		if len(spec.Files) != 2 || spec.Files[0].Name != "input_reference" || spec.Files[0].Reference.URL != "https://cdn.example/b.png" {
			t.Fatalf("reference order lost: %#v", spec.Files)
		}
	}
}

func TestQtraderH3FramesJSONAndRoles(t *testing.T) {
	adapter := qtraderH3Adapter(t)
	request := GenerationRequest{Model: "h3-video-frames", Prompt: "a continuous shot", Duration: 6, Resolution: "768p", AspectRatio: "16:9",
		Images: []MediaReference{{URL: "https://cdn.example/last.png", Role: "last_frame", Order: 2}, {URL: "https://cdn.example/first.png", Role: "first_frame", Order: 1}}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/videos" || spec.ContentType != "application/json" || len(spec.Files) != 0 {
		t.Fatalf("invalid H3 Frames request envelope: %#v", spec)
	}
	body, ok := spec.Body.(map[string]any)
	if !ok || body["model"] != "h3-video-frames" || body["duration"] != 6 || body["resolution"] != "768P" || body["ratio"] != "16:9" {
		t.Fatalf("invalid H3 Frames request: %#v", body)
	}
	content, ok := body["content"].([]any)
	if !ok || len(content) != 3 || content[0].(map[string]any)["type"] != "text" {
		t.Fatalf("invalid H3 Frames content: %#v", body["content"])
	}
	first, _ := content[1].(map[string]any)
	last, _ := content[2].(map[string]any)
	if first["role"] != "first_frame" || last["role"] != "last_frame" {
		t.Fatalf("frame roles were not preserved: %#v", content)
	}
}

func TestQtraderH3FramesRejectsInvalidInputs(t *testing.T) {
	adapter := qtraderH3Adapter(t)
	for _, mutate := range []func(*GenerationRequest){
		func(r *GenerationRequest) { r.Images = nil },
		func(r *GenerationRequest) { r.Images = []MediaReference{{URL: "https://cdn.example/a.png", Role: "reference_image"}} },
		func(r *GenerationRequest) { r.Images = []MediaReference{{URL: "https://cdn.example/a.png", Role: "first_frame"}, {URL: "https://cdn.example/b.png", Role: "first_frame"}} },
		func(r *GenerationRequest) { r.Images = []MediaReference{{URL: "https://cdn.example/a.png", Role: "first_frame"}, {URL: "https://cdn.example/b.png", Role: "reference_image"}} },
		func(r *GenerationRequest) { r.Duration = 16 },
		func(r *GenerationRequest) { r.Audios = []MediaReference{{URL: "https://cdn.example/a.wav"}} },
	} {
		request := GenerationRequest{Model: "h3-video-frames", Prompt: "a clip", Duration: 6, Resolution: "768p", AspectRatio: "16:9",
			Images: []MediaReference{{URL: "https://cdn.example/a.png", Role: "first_frame"}}}
		mutate(&request)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("invalid H3 Frames input accepted: %#v", request)
		}
	}
}

func TestQtraderH3RejectsUnsupportedInput(t *testing.T) {
	adapter := qtraderH3Adapter(t)
	for _, mutate := range []func(*GenerationRequest){
		func(r *GenerationRequest) { r.Duration = 3 },
		func(r *GenerationRequest) { r.Duration = 31 },
		func(r *GenerationRequest) { r.Resolution = "1080p"; r.Duration = 16 },
		func(r *GenerationRequest) { r.AspectRatio = "21:9"; r.Duration = 21 },
		func(r *GenerationRequest) { r.Resolution = "720p"; r.AspectRatio = "1:1" },
		func(r *GenerationRequest) {
			r.Images = []MediaReference{{URL: "https://cdn.example/a.png", Role: "first_frame"}}
		},
		func(r *GenerationRequest) { r.Audios = []MediaReference{{URL: "https://cdn.example/a.wav"}} },
		func(r *GenerationRequest) { r.Model = "img-2-5s" },
	} {
		request := GenerationRequest{Model: "h3-video", Prompt: "a clip", Duration: 6, Resolution: "768p", AspectRatio: "16:9"}
		mutate(&request)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("unsupported input accepted: %#v", request)
		}
	}
}

func TestQtraderH3ResultAndError(t *testing.T) {
	adapter := qtraderH3Adapter(t)
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "h3-task"}, []byte(`{"id":"h3-task","status":"completed","sparkcine":{"outputs":[{"download_url":"https://cdn.example/result.mp4"}]}}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://cdn.example/result.mp4" {
		t.Fatalf("invalid completion: %#v, %v", result, err)
	}
	failed, err := adapter.ParseCreate(context.Background(), []byte(`{"error":{"message":"rejected","type":"upstream_error"}}`))
	if err != nil || failed.Status != StatusFailed {
		t.Fatalf("upstream failure lost: %#v, %v", failed, err)
	}
}
