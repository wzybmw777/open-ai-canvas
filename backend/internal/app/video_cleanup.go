package app

import (
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/videocleanup"
)

type VideoCleanupRequest struct {
	ResourceID     string `json:"resourceId"`
	Model          string `json:"model"`
	LogicalModelID string `json:"logicalModelId,omitempty"`
	ChannelID      string `json:"channelId,omitempty"`
	Prompt         string `json:"prompt,omitempty"`
	Resolution     string `json:"resolution,omitempty"`
}

type VideoCleanupAvailability struct {
	Available  bool   `json:"available"`
	MaxBytes   int    `json:"maxBytes"`
	MinSeconds int    `json:"minSeconds"`
	MaxSeconds int    `json:"maxSeconds"`
	Message    string `json:"message,omitempty"`
}

func (s *Service) VideoCleanupStatus(userID string) (*VideoCleanupAvailability, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureVideoWorkbench); err != nil {
		return nil, err
	}
	status := &VideoCleanupAvailability{Available: true, MaxBytes: videocleanup.MaxBytes, MinSeconds: 3, MaxSeconds: 15}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		status.Available = false
		status.Message = "服务器缺少视频探测组件，请联系管理员更新后端镜像"
	}
	return status, nil
}

func (s *Service) CreateVideoCleanupTask(userID string, req VideoCleanupRequest, traceID, requestID string) (*model.Task, error) {
	status, err := s.VideoCleanupStatus(userID)
	if err != nil {
		return nil, err
	}
	if !status.Available {
		return nil, &AppError{Status: 503, Code: 503, Message: status.Message}
	}
	if strings.TrimSpace(req.Model) == "" || (strings.TrimSpace(req.ChannelID) == "") == (strings.TrimSpace(req.LogicalModelID) == "") {
		return nil, BadAuthRequest("请选择一个可用的平台视频编辑模型")
	}
	resource, err := s.Resource(userID, strings.TrimSpace(req.ResourceID))
	if err != nil || resource == nil {
		return nil, NotFound("原视频不存在或不可访问")
	}
	if resource.Status != model.ResourceStatusReady || resource.Kind != "video" || resource.Size <= 0 || resource.Size > videocleanup.MaxBytes || (resource.MimeType != "video/mp4" && resource.MimeType != "video/quicktime") {
		return nil, BadAuthRequest("原视频须为已就绪的 MP4 或 MOV 文件，大小不超过 100MB")
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		prompt = "去除视频中可见的水印、台标、叠加文字或标识，按周围背景自然修复。尽量保持主体动作、镜头运动、构图和视频时长连续，不添加新的文字或水印。"
	}
	if utf8.RuneCountInString(prompt) > 2500 {
		return nil, BadAuthRequest("处理要求最多 2500 个字符")
	}
	_, reader, err := s.OpenResource(userID, resource.ID)
	if err != nil {
		return nil, err
	}
	meta, probeErr := videocleanup.Probe(reader)
	reader.Close()
	if probeErr != nil {
		return nil, BadAuthRequest(probeErr.Error())
	}
	seconds := int(math.Ceil(float64(meta.DurationMs) / 1000))
	input := map[string]any{"mode": "video", "prompt": prompt, "resourceId": resource.ID,
		"referenceVideos": []map[string]any{{"resourceId": resource.ID, "storageKey": "resource:" + resource.ID, "width": meta.Width, "height": meta.Height, "durationMs": meta.DurationMs, "bytes": resource.Size}},
		"metadata":        map[string]any{"source": "workbench", "workbenchKind": "video", "edit": "remove_watermark", "videoEditOperation": "video_edit"}}
	parameters := map[string]any{"seconds": seconds, "resolution": strings.TrimSpace(req.Resolution), "watermark": false}
	config, err := s.resolveWorkbenchProviderConfig(WorkbenchKindVideo, strings.TrimSpace(req.Model), strings.TrimSpace(req.LogicalModelID), strings.TrimSpace(req.ChannelID), parameters, input)
	if err != nil {
		return nil, err
	}
	config["videoSeconds"] = strconv.Itoa(seconds)
	input["config"] = config
	// Public media URL availability must fail before charging, not in the worker.
	if _, err := s.providerResourceURL(resource, time.Time{}); err != nil {
		return nil, err
	}
	return s.CreateTask(userID, CreateTaskRequest{Type: "canvas_video", Operation: "video_edit", Prompt: prompt, Model: strings.TrimSpace(req.Model), LogicalModelID: strings.TrimSpace(req.LogicalModelID), Input: input, TraceID: traceID, RequestID: requestID, workbenchKind: WorkbenchKindVideo})
}
