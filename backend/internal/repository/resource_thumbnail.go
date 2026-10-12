package repository

import (
	"time"
	"yingce/backend/internal/model"
)

func (r *Repository) ClaimResourceThumbnail(userID, id string, now time.Time) (bool, error) {
	result := r.db.Model(&model.Resource{}).
		Where("user_id = ? AND id = ? AND status = ? AND kind = ?", userID, id, model.ResourceStatusReady, "image").
		Where("thumbnail_status = '' OR thumbnail_status IS NULL OR (thumbnail_status IN ? AND updated_at < ?)", []string{"processing", "failed"}, now.Add(-10*time.Minute)).
		Updates(map[string]any{"thumbnail_status": "processing", "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) FinishResourceThumbnail(resource *model.Resource, values map[string]any) (bool, error) {
	result := r.db.Model(&model.Resource{}).
		Where("user_id = ? AND id = ? AND status = ? AND thumbnail_status = ? AND object_key = ? AND e_tag = ?", resource.UserID, resource.ID, model.ResourceStatusReady, "processing", resource.ObjectKey, resource.ETag).
		Updates(values)
	return result.RowsAffected == 1, result.Error
}
