package app

import (
	"context"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCanRunProviderTaskRequiresVideoConfig(t *testing.T) {
	tests := []struct {
		name string
		task model.Task
		want bool
	}{
		{
			name: "channel config",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"model":"veo","channelId":"channel-1"}}`},
			want: true,
		},
		{
			name: "direct config",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"model":"veo","baseUrl":"https://example.test","apiKey":"secret"}}`},
			want: true,
		},
		{
			name: "missing model",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"channelId":"channel-1"}}`},
			want: false,
		},
		{
			name: "missing direct credentials",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"model":"veo","baseUrl":"https://example.test"}}`},
			want: false,
		},
		{
			name: "non video task",
			task: model.Task{Type: "text_generation", InputJSON: `{"mode":"video","config":{"model":"veo","channelId":"channel-1"}}`},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canRunProviderTask(tt.task); got != tt.want {
				t.Fatalf("canRunProviderTask() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestProcessTaskRejectsVideoTaskWithoutProviderConfig(t *testing.T) {
	svc := &Service{}
	_, _, err := svc.processTask(context.Background(), model.Task{
		Type:      "video_generate",
		InputJSON: `{"mode":"video","config":{"model":""}}`,
	})
	if err == nil {
		t.Fatal("processTask() error = nil, want missing provider configuration error")
	}
	if err.Error() != "视频任务缺少可执行的模型配置" {
		t.Fatalf("processTask() error = %q, want explicit provider configuration error", err)
	}
}

func TestValidateTaskType(t *testing.T) {
	tests := []struct {
		name     string
		taskType string
		wantErr  bool
	}{
		{name: "missing", taskType: "", wantErr: true},
		{name: "canvas image", taskType: "canvas_image"},
		{name: "video operation", taskType: "video_image_to_video"},
		{name: "unknown canvas type", taskType: "canvas_unknown", wantErr: true},
		{name: "unknown type", taskType: "workflow_router", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateTaskType(tt.taskType); (err != nil) != tt.wantErr {
				t.Fatalf("validateTaskType(%q) error = %v, wantErr %v", tt.taskType, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTaskGenerationMode(t *testing.T) {
	valid := map[string]string{
		"text": "text", "canvas_text": "text", "canvas_image": "image",
		"canvas_video": "video", "canvas_audio": "audio",
	}
	for taskType, mode := range valid {
		t.Run(taskType, func(t *testing.T) {
			if err := validateTaskGenerationMode(taskType, map[string]any{"mode": mode}); err != nil {
				t.Fatalf("validateTaskGenerationMode() error = %v", err)
			}
		})
	}
	for _, input := range []map[string]any{{}, {"mode": "image"}, {"mode": " text "}} {
		if err := validateTaskGenerationMode("canvas_text", input); err == nil {
			t.Fatalf("validateTaskGenerationMode(canvas_text, %#v) error = nil", input)
		}
	}
	if err := validateTaskGenerationMode("video_generate", map[string]any{"mode": "video"}); err != nil {
		t.Fatalf("legacy video operation mode validation changed: %v", err)
	}
}

func TestCreateTaskRejectsMissingGenerationModeBeforeRouting(t *testing.T) {
	_, err := (&Service{}).CreateTask("user", CreateTaskRequest{
		Type: "canvas_text", Prompt: "generate storyboard", Input: map[string]any{},
	})
	if err == nil || err.Error() != "任务类型 canvas_text 必须使用 text 生成模式" {
		t.Fatalf("CreateTask() error = %v", err)
	}
}

func TestProcessTaskRejectsUnknownType(t *testing.T) {
	_, _, err := (&Service{}).processTask(context.Background(), model.Task{
		Type:      "workflow_router",
		InputJSON: `{}`,
	})
	if err == nil {
		t.Fatal("processTask() error = nil, want unsupported task type error")
	}
	if err.Error() != "不支持的任务类型：workflow_router" {
		t.Fatalf("processTask() error = %q, want unsupported task type error", err)
	}
}
