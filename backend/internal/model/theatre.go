package model

import "time"

const (
	TheatreWorkVideo      = "video"
	TheatreWorkShortDrama = "short_drama"
)

type TheatreWork struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	UserID          string    `json:"userId" gorm:"index;size:36;not null"`
	ResourceID      string    `json:"resourceId" gorm:"uniqueIndex;size:36;not null"`
	CoverResourceID string    `json:"coverResourceId" gorm:"index;size:36;not null;default:''"`
	Kind            string    `json:"kind" gorm:"index;size:24;not null;default:video"`
	IsComplete      bool      `json:"isComplete" gorm:"not null;default:false"`
	Title           string    `json:"title" gorm:"size:120;not null"`
	Description     string    `json:"description" gorm:"type:text"`
	CreatedAt       time.Time `json:"createdAt" gorm:"index"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type TheatreEpisode struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	WorkID     string    `json:"workId" gorm:"size:36;not null;uniqueIndex:idx_theatre_episode_number,priority:1"`
	ResourceID string    `json:"resourceId" gorm:"index;size:36;not null"`
	Number     int       `json:"number" gorm:"not null;uniqueIndex:idx_theatre_episode_number,priority:2"`
	Title      string    `json:"title" gorm:"size:120;not null"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}
