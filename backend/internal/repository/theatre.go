package repository

import (
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrTheatreRevisionConflict = errors.New("theatre work revision conflict")
var ErrTheatreResourceConflict = errors.New("theatre preview resource already published")

type TheatreWorkRecord struct {
	model.TheatreWork
	AuthorName   string `json:"authorName"`
	Size         int64  `json:"size"`
	DurationMs   int64  `json:"durationMs"`
	EpisodeCount int64  `json:"episodeCount"`
}

type TheatreEpisodeRecord struct {
	model.TheatreEpisode
	Size       int64 `json:"size"`
	DurationMs int64 `json:"durationMs"`
}

func (r *Repository) theatreWorksQuery() *gorm.DB {
	return r.db.Table("theatre_works").
		Joins("JOIN resources ON resources.id = theatre_works.resource_id AND resources.user_id = theatre_works.user_id").
		Joins("JOIN users ON users.id = theatre_works.user_id").
		Where("resources.status = ? AND users.status = ?", model.ResourceStatusReady, model.UserStatusActive)
}

const theatreWorkColumns = "theatre_works.*, COALESCE(NULLIF(users.display_name, ''), users.username) AS author_name, resources.size, resources.duration_ms, (SELECT count(*) FROM theatre_episodes WHERE theatre_episodes.work_id = theatre_works.id) AS episode_count"

func (r *Repository) TheatreWorks(ownerID, keyword, kind string, page, pageSize int) ([]TheatreWorkRecord, int64, error) {
	query := r.theatreWorksQuery()
	if ownerID != "" {
		query = query.Where("theatre_works.user_id = ?", ownerID)
	}
	if keyword != "" {
		pattern := "%" + strings.ToLower(keyword) + "%"
		query = query.Where("LOWER(theatre_works.title) LIKE ? OR LOWER(theatre_works.description) LIKE ?", pattern, pattern)
	}
	if kind != "" {
		query = query.Where("theatre_works.kind = ?", kind)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	works := []TheatreWorkRecord{}
	err := query.Select(theatreWorkColumns).
		Order("theatre_works.created_at DESC, theatre_works.id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Scan(&works).Error
	return works, total, err
}

func (r *Repository) TheatreWorkRecord(id string) (*TheatreWorkRecord, error) {
	var work TheatreWorkRecord
	err := r.theatreWorksQuery().Select(theatreWorkColumns).Where("theatre_works.id = ?", id).Take(&work).Error
	return &work, err
}

func (r *Repository) TheatreEpisodes(workID string) ([]TheatreEpisodeRecord, error) {
	episodes := []TheatreEpisodeRecord{}
	err := r.db.Table("theatre_episodes").
		Joins("JOIN theatre_works ON theatre_works.id = theatre_episodes.work_id").
		Joins("JOIN resources ON resources.id = theatre_episodes.resource_id AND resources.user_id = theatre_works.user_id").
		Where("theatre_episodes.work_id = ? AND resources.status = ?", workID, model.ResourceStatusReady).
		Select("theatre_episodes.*, resources.size, resources.duration_ms").Order("theatre_episodes.number").Scan(&episodes).Error
	return episodes, err
}

func (r *Repository) TheatreEpisode(workID, episodeID string) (*model.TheatreEpisode, error) {
	var episode model.TheatreEpisode
	err := r.db.Where("work_id = ? AND id = ?", workID, episodeID).First(&episode).Error
	return &episode, err
}

func (r *Repository) TheatreWork(id string) (*model.TheatreWork, error) {
	var work model.TheatreWork
	err := r.db.First(&work, "id = ?", id).Error
	return &work, err
}

// Lock referenced resources in ID order so publication and replacement serialize with cleanup.
func (r *Repository) lockTheatreResources(tx *gorm.DB, userID string, videoIDs []string, coverID string) error {
	ids := []string{}
	videos := map[string]bool{}
	for _, id := range videoIDs {
		if id != "" && !videos[id] {
			ids = append(ids, id)
			videos[id] = true
		}
	}
	if coverID != "" {
		ids = append(ids, coverID)
	}
	if len(ids) == 0 {
		return nil
	}
	var resources []model.Resource
	query := tx.Where("id IN ? AND user_id = ? AND status = ?", ids, userID, model.ResourceStatusReady).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Find(&resources).Error; err != nil {
		return err
	}
	if len(resources) != len(ids) {
		return gorm.ErrRecordNotFound
	}
	for _, resource := range resources {
		if (videos[resource.ID] && resource.Kind != "video") || (resource.ID == coverID && resource.Kind != "image") {
			return gorm.ErrRecordNotFound
		}
	}
	return nil
}

func (r *Repository) CreateTheatreWork(work *model.TheatreWork, episodes []model.TheatreEpisode) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		videoIDs := []string{work.ResourceID}
		for _, episode := range episodes {
			videoIDs = append(videoIDs, episode.ResourceID)
		}
		if err := r.lockTheatreResources(tx, work.UserID, videoIDs, work.CoverResourceID); err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "resource_id"}}, DoNothing: true}).Create(work).Error; err != nil {
			return err
		}
		var published model.TheatreWork
		if err := tx.Where("resource_id = ? AND user_id = ?", work.ResourceID, work.UserID).First(&published).Error; err != nil {
			return err
		}
		if published.Kind != work.Kind {
			return ErrTheatreResourceConflict
		}
		if published.ID == work.ID && len(episodes) > 0 {
			if err := tx.Create(&episodes).Error; err != nil {
				return err
			}
		}
		*work = published
		return nil
	})
}

func (r *Repository) UpdateTheatreWork(userID, id, title, description string, coverID *string, complete *bool, episodes *[]model.TheatreEpisode, expected *time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		values := map[string]any{"title": title, "description": description, "updated_at": time.Now()}
		if complete != nil {
			values["is_complete"] = *complete
		}
		videoIDs := []string{}
		if episodes != nil {
			for _, episode := range *episodes {
				videoIDs = append(videoIDs, episode.ResourceID)
			}
			values["resource_id"] = (*episodes)[0].ResourceID
		}
		newCover := ""
		if coverID != nil {
			newCover = *coverID
			values["cover_resource_id"] = *coverID
		}
		if err := r.lockTheatreResources(tx, userID, videoIDs, newCover); err != nil {
			return err
		}
		var current model.TheatreWork
		query := tx.Where("id = ? AND user_id = ?", id, userID)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&current).Error; err != nil {
			return err
		}
		if expected != nil && !expected.Equal(current.UpdatedAt) {
			return ErrTheatreRevisionConflict
		}
		if episodes != nil {
			var occupied int64
			if err := tx.Model(&model.TheatreWork{}).Where("resource_id = ? AND id <> ?", (*episodes)[0].ResourceID, id).Count(&occupied).Error; err != nil {
				return err
			}
			if occupied > 0 {
				return ErrTheatreResourceConflict
			}
			var old []model.TheatreEpisode
			if err := tx.Where("work_id = ?", id).Find(&old).Error; err != nil {
				return err
			}
			byResource := map[string]model.TheatreEpisode{}
			for _, episode := range old {
				byResource[episode.ResourceID] = episode
			}
			for i := range *episodes {
				if previous, ok := byResource[(*episodes)[i].ResourceID]; ok {
					(*episodes)[i].ID = previous.ID
					(*episodes)[i].CreatedAt = previous.CreatedAt
				}
			}
			// Replace within one transaction to avoid transient duplicate episode numbers.
			if err := tx.Where("work_id = ?", id).Delete(&model.TheatreEpisode{}).Error; err != nil {
				return err
			}
			if err := tx.Create(episodes).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&model.TheatreWork{}).Where("id = ? AND user_id = ?", id, userID).Updates(values)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *Repository) DeleteTheatreWork(userID, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&model.TheatreWork{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Where("work_id = ?", id).Delete(&model.TheatreEpisode{}).Error
	})
}
