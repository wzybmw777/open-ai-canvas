package app

import (
	"io"
	"strings"

	"yingce/backend/internal/imagecleanup"
	"yingce/backend/internal/model"
)

type ImageCleanupParameters struct {
	Size            string `json:"size,omitempty"`
	Quality         string `json:"quality,omitempty"`
	ImageResolution string `json:"imageResolution,omitempty"`
}
type ImageCleanupRequest struct {
	ResourceID     string                 `json:"resourceId"`
	MaskResourceID string                 `json:"maskResourceId,omitempty"`
	Model          string                 `json:"model"`
	LogicalModelID string                 `json:"logicalModelId,omitempty"`
	ChannelID      string                 `json:"channelId,omitempty"`
	Parameters     ImageCleanupParameters `json:"parameters,omitempty"`
}
type ImageCleanupAvailability struct {
	Available    bool `json:"available"`
	MaxBytes     int  `json:"maxBytes"`
	MaxPixels    int  `json:"maxPixels"`
	MaxDimension int  `json:"maxDimension"`
}

func (s *Service) ImageCleanupStatus(userID string) (*ImageCleanupAvailability, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureWatermarkRemoval); err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureImageWorkbench); err != nil {
		return nil, err
	}
	return &ImageCleanupAvailability{Available: true, MaxBytes: imagecleanup.MaxBytes, MaxPixels: imagecleanup.MaxPixels, MaxDimension: imagecleanup.MaxDimension}, nil
}
func (s *Service) cleanupImageData(userID, resourceID string, mask bool) ([]byte, error) {
	resource, err := s.Resource(userID, resourceID)
	if err != nil || resource == nil {
		return nil, NotFound("图片资源不存在或不可访问")
	}
	if resource.Status != model.ResourceStatusReady || resource.Kind != "image" || resource.Size <= 0 || resource.Size > imagecleanup.MaxBytes {
		return nil, BadAuthRequest("图片资源未就绪或超过 10MB")
	}
	if (mask && resource.MimeType != "image/png") || (!mask && resource.MimeType != "image/png" && resource.MimeType != "image/jpeg" && resource.MimeType != "image/webp") {
		return nil, BadAuthRequest("原图须为 PNG、JPEG 或 WebP，遮罩须为 PNG")
	}
	_, reader, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, imagecleanup.MaxBytes+1))
	if err != nil {
		return nil, WrapAppError(502, "读取图片资源失败", err)
	}
	return data, nil
}
func (s *Service) CreateImageCleanupTask(userID string, req ImageCleanupRequest, traceID, requestID string) (*model.Task, error) {
	if _, err := s.ImageCleanupStatus(userID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Model) == "" || (strings.TrimSpace(req.ChannelID) == "") == (strings.TrimSpace(req.LogicalModelID) == "") {
		return nil, BadAuthRequest("请选择一个可用的平台图片模型")
	}
	req.ResourceID, req.MaskResourceID = strings.TrimSpace(req.ResourceID), strings.TrimSpace(req.MaskResourceID)
	if req.ResourceID == "" {
		return nil, BadAuthRequest("必须指定原图")
	}
	if req.ResourceID == req.MaskResourceID {
		return nil, BadAuthRequest("水印遮罩必须与原图分开上传")
	}
	source, err := s.cleanupImageData(userID, req.ResourceID, false)
	if err != nil {
		return nil, err
	}
	if _, err := imagecleanup.Dimensions(source); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	prompt := "去除原图中的可见水印、叠加文字或标识，并根据周围内容自然修复背景。尽量保持原图构图、主体、颜色、细节和比例，不添加新的文字或水印。"
	input := map[string]any{"mode": "image", "resourceId": req.ResourceID,
		"referenceImages": []map[string]any{{"resourceId": req.ResourceID, "storageKey": "resource:" + req.ResourceID}},
		"metadata":        map[string]any{"source": "workbench", "workbenchKind": "image", "edit": "remove_watermark"}}
	if req.MaskResourceID != "" {
		mask, err := s.cleanupImageData(userID, req.MaskResourceID, true)
		if err != nil {
			return nil, err
		}
		if _, err := imagecleanup.Validate(source, mask); err != nil {
			return nil, BadAuthRequest(err.Error())
		}
		input["maskResourceId"] = req.MaskResourceID
		input["mask"] = map[string]any{"resourceId": req.MaskResourceID, "storageKey": "resource:" + req.MaskResourceID}
		prompt = "只修复蒙版透明区域中的水印，按周围内容自然补全背景，其他区域尽量保持原样，不添加任何文字或水印。"
	}
	input["prompt"] = prompt
	parameters := map[string]any{"size": req.Parameters.Size, "quality": req.Parameters.Quality, "imageResolution": req.Parameters.ImageResolution, "count": 1}
	config, err := s.resolveWorkbenchProviderConfig(userID, WorkbenchKindImage, "image", strings.TrimSpace(req.Model), strings.TrimSpace(req.LogicalModelID), strings.TrimSpace(req.ChannelID), parameters, input)
	if err != nil {
		return nil, err
	}
	input["config"] = config
	return s.CreateTask(userID, CreateTaskRequest{Type: "canvas_image", Operation: "image", Prompt: prompt, Model: strings.TrimSpace(req.Model), LogicalModelID: strings.TrimSpace(req.LogicalModelID), Input: input, TraceID: traceID, RequestID: requestID, workbenchKind: WorkbenchKindImage})
}
