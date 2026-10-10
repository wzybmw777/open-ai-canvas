package model

import "time"

// ChannelSyncJob stores a reviewed adapter configuration, never executable shell code.
type ChannelSyncJob struct {
	ChannelID      string     `json:"channelId" gorm:"primaryKey;size:36"`
	Enabled        bool       `json:"enabled"`
	Script         string     `json:"script" gorm:"size:40"`
	SourceURL      string     `json:"sourceUrl" gorm:"size:512"`
	GroupID        int        `json:"groupId"`
	SyncPrices     bool       `json:"syncPrices"`
	ImportNew      bool       `json:"importNew"`
	NextRunAt      *time.Time `json:"nextRunAt" gorm:"index"`
	LastRunID      string     `json:"lastRunId" gorm:"size:36"`
	LeaseExpiresAt *time.Time `json:"-"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type ChannelSyncRun struct {
	ID         string     `json:"id" gorm:"primaryKey;size:36"`
	ChannelID  string     `json:"channelId" gorm:"size:36;index:idx_channel_sync_runs,priority:1"`
	Trigger    string     `json:"trigger" gorm:"size:20"`
	ActorID    string     `json:"actorId,omitempty" gorm:"size:36"`
	Status     string     `json:"status" gorm:"size:20;index"`
	Summary    string     `json:"summary" gorm:"type:text"`
	StartedAt  time.Time  `json:"startedAt" gorm:"index:idx_channel_sync_runs,priority:2"`
	FinishedAt *time.Time `json:"finishedAt"`
}
