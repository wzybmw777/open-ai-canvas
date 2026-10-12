package app

import (
	"bytes"
	"fmt"
	"log/slog"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func (s *Service) maybeStartResourceThumbnail(resource *model.Resource) {
	if resource == nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady || resource.Size > assets.ThumbnailMaxBytes || resource.ThumbnailStatus == "ready" || resource.ThumbnailStatus == "unsupported" {
		return
	}
	s.thumbnailMu.Lock()
	if s.thumbnailSlots == nil {
		s.thumbnailSlots = make(chan struct{}, 2)
	}
	slots := s.thumbnailSlots
	s.thumbnailMu.Unlock()
	select {
	case slots <- struct{}{}:
	default:
		return
	}
	copy := *resource
	if !s.runWorkerTask(func() {
		defer func() { <-slots }()
		claimed, err := s.repo.ClaimResourceThumbnail(copy.UserID, copy.ID, time.Now())
		if err != nil {
			slog.Warn("resource thumbnail claim failed", "resource_id", copy.ID)
			return
		}
		if !claimed {
			return
		}
		if err := s.generateResourceThumbnail(&copy); err != nil {
			slog.Warn("resource thumbnail preparation failed", "resource_id", copy.ID)
			if _, saveErr := s.repo.FinishResourceThumbnail(&copy, map[string]any{"thumbnail_status": "failed"}); saveErr != nil {
				slog.Error("resource thumbnail failure state could not be saved", "resource_id", copy.ID)
			}
		}
	}) {
		<-slots
	}
}

func (s *Service) generateResourceThumbnail(resource *model.Resource) error {
	var setting ossSettingValue
	var stream *ResourceStream
	var err error
	if resource.Provider == "local" {
		stream, err = s.openResourceRange(resource.UserID, resource, "")
	} else {
		setting, err = s.ossSettingForResource(resource.UserID, resource)
		if err != nil {
			return err
		}
		setting = s.storageSettingWithRuntimePolicy(setting)
		// Keep each transfer below the reclaim window even if the deployment
		// permits long transfers for original videos or exports.
		setting.Runtime.TransferTimeout = min(setting.Runtime.TransferTimeout, 2*time.Minute)
		remote, readErr := getOriginOSSObjectRange(setting, resource.ObjectKey, "")
		err = readErr
		if err == nil {
			stream = &ResourceStream{Resource: resource, Body: remote.Body}
		}
	}
	if err != nil {
		return err
	}
	defer stream.Body.Close()
	thumbnail, err := assets.MakeThumbnail(stream.Body)
	if err != nil {
		return err
	}
	derived := *resource
	derived.ObjectKey = assets.ThumbnailObjectKey(resource.ObjectKey)
	derived.MimeType, derived.Size = thumbnail.MimeType, int64(len(thumbnail.Data))
	if resource.Provider == "local" {
		_, err = s.storeResourceObject(&derived, "", bytes.NewReader(thumbnail.Data))
	} else {
		_, err = putOSSObject(setting, derived.ObjectKey, derived.MimeType, derived.Size, bytes.NewReader(thumbnail.Data))
	}
	if err != nil {
		return err
	}
	values := map[string]any{
		"thumbnail_status": "ready", "thumbnail_mime_type": thumbnail.MimeType,
		"thumbnail_size": len(thumbnail.Data), "thumbnail_width": thumbnail.Width, "thumbnail_height": thumbnail.Height,
	}
	if resource.Width <= 0 || resource.Height <= 0 {
		values["width"], values["height"] = thumbnail.OriginalWidth, thumbnail.OriginalHeight
	}
	updated, err := s.repo.FinishResourceThumbnail(resource, values)
	if err != nil || !updated {
		// A deletion can win during encoding/upload. Do not recreate its row.
		if cleanupErr := s.deleteSingleStoredResourceObject(resource.UserID, &derived); cleanupErr != nil {
			return fmt.Errorf("清理未发布缩略图失败: %w", cleanupErr)
		}
		if err != nil {
			return err
		}
		return fmt.Errorf("缩略图资源已删除或已更新")
	}
	return nil
}

func (s *Service) openResourceThumbnailRange(userID string, resource *model.Resource, rangeHeader string) (*ResourceStream, error) {
	if resource.UserID != userID || resource.ThumbnailStatus != "ready" {
		return nil, Forbidden("缩略图不可访问")
	}
	copy := *resource
	copy.ObjectKey = assets.ThumbnailObjectKey(resource.ObjectKey)
	copy.MimeType, copy.Size = resource.ThumbnailMimeType, resource.ThumbnailSize
	copy.Width, copy.Height = resource.ThumbnailWidth, resource.ThumbnailHeight
	return s.openResourceRange(userID, &copy, rangeHeader)
}
