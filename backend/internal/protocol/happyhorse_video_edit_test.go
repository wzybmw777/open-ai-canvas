package protocol

import (
	"context"
	"testing"
)

func TestHappyHorseVideoEditProtocol(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-happyhorse-video-edit.yingce-plugin", "dashscope-happyhorse-video-edit")
	request := GenerationRequest{Model: "happyhorse-1.0-video-edit", Prompt: "去掉右上角水印", Duration: 3, AspectRatio: "16:9", Resolution: "720p", Operation: "video_edit", Videos: []MediaReference{{URL: "https://cdn.example/source.mp4", Kind: "video"}}, Inputs: []MediaReference{{URL: "https://cdn.example/source.mp4", Kind: "video"}}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	input := body["input"].(map[string]any)
	media := input["media"].([]any)
	params := body["parameters"].(map[string]any)
	if spec.Path != "/api/v1/services/aigc/video-generation/video-synthesis" || !spec.OriginPath || spec.Headers["X-DashScope-Async"] != "enable" || len(media) != 1 || media[0].(map[string]any)["type"] != "video" || media[0].(map[string]any)["url"] != "https://cdn.example/source.mp4" {
		t.Fatalf("request=%#v body=%#v", spec, body)
	}
	if params["resolution"] != "720P" || params["watermark"] != false || params["audio_setting"] != "origin" || params["duration"] != nil || params["ratio"] != nil || params["audio"] != nil {
		t.Fatalf("parameters=%#v", params)
	}
	request.Model = "wan3.0-video"
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("wrong model accepted")
	}
	request.Model = "happyhorse-1.0-video-edit"
	request.Videos = nil
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("missing video accepted")
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"output":{"task_id":"edit-task","task_status":"PENDING"}}`))
	if err != nil || created.TaskID != "edit-task" {
		t.Fatalf("created=%#v err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Path != "/api/v1/tasks/edit-task" || !poll.OriginPath {
		t.Fatalf("poll=%#v err=%v", poll, err)
	}
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"output":{"task_status":"SUCCEEDED","video_url":"https://cdn.example/result.mp4"},"usage":{"duration":6}}`))
	if err != nil || result.Status != StatusSucceeded || len(result.Result.Videos) != 1 || !result.Result.Videos[0].Ephemeral {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"output":{"task_status":"FAILED","code":"InvalidParameter","message":"bad video"}}`))
	if err != nil || failed.Status != StatusFailed {
		t.Fatalf("failed=%#v err=%v", failed, err)
	}
}
