package protocol

import (
	"context"
	"testing"
)

func TestYuxiBoxVideoRequestAndAuthenticatedResult(t *testing.T) {
	adapter := officialPackageAdapter(t, "yuxibox-video.yingce-plugin", "yuxibox-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "seedance-2.0（YX）", Prompt: "test", Duration: 15, AspectRatio: "auto",
		Images: []MediaReference{{URL: "https://example.com/second.png", Order: 2}, {URL: "https://example.com/first.png", Order: 1}},
		Videos: []MediaReference{{URL: "https://example.com/video.mp4"}},
		Audios: []MediaReference{{URL: "https://example.com/audio.mp3"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/videos" || body["seconds"] != "15" || body["ratio"] != "adaptive" || body["size"] != nil || body["duration"] != nil {
		t.Fatalf("request mismatch: %#v", body)
	}
	images := body["reference_images"].([]any)
	if len(images) != 2 || images[0] != "https://example.com/first.png" || len(body["videos"].([]any)) != 1 || len(body["audios"].([]any)) != 1 {
		t.Fatal(body)
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"yx-task","status":"queued"}`))
	if err != nil || created.TaskID != "yx-task" || created.Status != StatusPending {
		t.Fatalf("create = %#v %v", created, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "yx-task"}, []byte(`{"id":"yx-task","status":"completed"}`))
	if err != nil || completed.Status != StatusSucceeded {
		t.Fatalf("poll = %#v %v", completed, err)
	}
	download, err := adapter.(ResultAdapter).BuildResult(context.Background(), PollContext{TaskID: "yx-task"})
	if err != nil || download.Path != "/v1/videos/yx-task/content" || download.Auth.Type != "bearer" {
		t.Fatalf("result = %#v %v", download, err)
	}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "seedance-2.0（YX）", Prompt: "test"}}); err == nil {
		t.Fatal("missing duration accepted")
	}
}
