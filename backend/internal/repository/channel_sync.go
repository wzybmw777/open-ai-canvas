package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrChannelSyncBusy = errors.New("渠道同步正在执行，或配置已变化，请稍后重试")

func (r *Repository) ChannelSyncJob(id string) (*model.ChannelSyncJob, error) {
	var job model.ChannelSyncJob
	err := r.db.First(&job, "channel_id = ?", id).Error
	return &job, err
}

func (r *Repository) SaveChannelSyncJob(job *model.ChannelSyncJob) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var old model.ChannelSyncJob
		err := tx.First(&old, "channel_id = ?", job.ChannelID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(job).Error
		}
		if err != nil {
			return err
		}
		if old.LeaseExpiresAt != nil && old.LeaseExpiresAt.After(time.Now()) {
			return ErrChannelSyncBusy
		}
		// A scheduler may have advanced the next run since app read the config.
		// Preserve the latest stored schedule while an enabled job stays enabled.
		if old.Enabled && job.Enabled && old.NextRunAt != nil {
			job.NextRunAt = old.NextRunAt
		}
		result := tx.Model(&model.ChannelSyncJob{}).Where("channel_id = ? AND updated_at = ?", old.ChannelID, old.UpdatedAt).
			Updates(map[string]any{"enabled": job.Enabled, "script": job.Script, "source_url": job.SourceURL,
				"group_id": job.GroupID, "sync_prices": job.SyncPrices, "import_new": job.ImportNew, "next_run_at": job.NextRunAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrChannelSyncBusy
		}
		return tx.First(job, "channel_id = ?", job.ChannelID).Error
	})
}

func (r *Repository) DueChannelSyncJobs(now time.Time) ([]model.ChannelSyncJob, error) {
	var jobs []model.ChannelSyncJob
	err := r.db.Where("enabled = ? AND next_run_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)", true, now, now).
		Where("EXISTS (SELECT 1 FROM model_channels c WHERE c.id = channel_sync_jobs.channel_id AND c.scope = ? AND c.enabled = ? AND c.deleted_at IS NULL)", model.ChannelScopeSystem, true).
		Order("next_run_at asc, channel_id asc").Limit(100).Find(&jobs).Error
	return jobs, err
}

func (r *Repository) RecoverExpiredChannelSync(now time.Time) error {
	var jobs []model.ChannelSyncJob
	if err := r.db.Where("lease_expires_at IS NOT NULL AND lease_expires_at <= ?", now).Find(&jobs).Error; err != nil {
		return err
	}
	for _, job := range jobs {
		if err := r.db.Transaction(func(tx *gorm.DB) error {
			var run model.ChannelSyncRun
			if err := tx.First(&run, "id = ?", job.LastRunID).Error; err != nil {
				return err
			}
			updates := map[string]any{"lease_expires_at": nil}
			if job.Enabled && run.Trigger == "scheduled" && run.Status == "running" {
				updates["next_run_at"] = now
			}
			result := tx.Model(&model.ChannelSyncJob{}).Where("channel_id = ? AND last_run_id = ? AND lease_expires_at <= ?", job.ChannelID, job.LastRunID, now).Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return nil
			}
			return tx.Model(&model.ChannelSyncRun{}).Where("id = ? AND status = ?", run.ID, "running").Updates(map[string]any{"status": "failed", "summary": "执行进程中断，租约已过期", "finished_at": now}).Error
		}); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) ClaimChannelSync(job model.ChannelSyncJob, run *model.ChannelSyncRun, next time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		lease := run.StartedAt.Add(5 * time.Minute)
		updates := map[string]any{"last_run_id": run.ID, "lease_expires_at": lease}
		if run.Trigger == "scheduled" || job.NextRunAt != nil && !job.NextRunAt.After(run.StartedAt) {
			updates["next_run_at"] = next
		}
		query := tx.Model(&model.ChannelSyncJob{}).Where("channel_id = ? AND updated_at = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)", job.ChannelID, job.UpdatedAt, run.StartedAt)
		if run.Trigger == "scheduled" {
			query = query.Where("enabled = ? AND next_run_at <= ?", true, run.StartedAt)
		}
		result := query.Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrChannelSyncBusy
		}
		if job.LastRunID != "" {
			if err := tx.Model(&model.ChannelSyncRun{}).Where("id = ? AND status = ?", job.LastRunID, "running").
				Updates(map[string]any{"status": "failed", "summary": "执行进程中断，租约已过期", "finished_at": run.StartedAt}).Error; err != nil {
				return err
			}
		}
		return tx.Create(run).Error
	})
}

func (r *Repository) ChannelSyncRuns(id string, limit int) ([]model.ChannelSyncRun, error) {
	var runs []model.ChannelSyncRun
	err := r.db.Where("channel_id = ?", id).Order("started_at desc").Limit(limit).Find(&runs).Error
	return runs, err
}

// FinishChannelSync commits all model changes and the run result together. Stale
// leases and concurrent admin edits reject the entire plan, including new models.
func (r *Repository) FinishChannelSync(run *model.ChannelSyncRun, channel *model.ModelChannel, changed, added []model.ChannelModel) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var job model.ChannelSyncJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&job, "channel_id = ?", run.ChannelID).Error; err != nil {
			return err
		}
		if job.LastRunID != run.ID || job.LeaseExpiresAt == nil || !job.LeaseExpiresAt.After(time.Now()) {
			return ErrChannelSyncBusy
		}
		if run.Status == "success" {
			var current model.ModelChannel
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ? AND scope = ?", channel.ID, model.ChannelScopeSystem).Error; err != nil {
				return err
			}
			if !current.UpdatedAt.Equal(channel.UpdatedAt) {
				return ErrChannelModelPriceConflict
			}
			for _, item := range changed {
				result := tx.Model(&model.ChannelModel{}).Where("id = ? AND channel_id = ? AND updated_at = ? AND price_version = ?", item.ID, run.ChannelID, item.UpdatedAt, item.PriceVersion).
					Updates(map[string]any{"description": item.Description, "enabled": item.Enabled, "unit_price_microcredits": item.UnitPriceMicrocredits, "price_version": item.PriceVersion + 1})
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return ErrChannelModelPriceConflict
				}
				for _, tier := range item.PriceTiers {
					if !tier.Enabled || !tier.PriceConfigured {
						continue
					}
					var original model.ChannelModelPriceTier
					if err := tx.First(&original, "id = ? AND channel_model_id = ?", tier.ID, item.ID).Error; err != nil {
						return err
					}
					if !original.UpdatedAt.Equal(tier.UpdatedAt) || original.PriceVersion != tier.PriceVersion {
						return ErrChannelModelPriceConflict
					}
					if original.UnitPriceMicrocredits == tier.UnitPriceMicrocredits && original.CostPricing.UnitPriceMicrocredits == tier.CostPricing.UnitPriceMicrocredits {
						continue
					}
					result = tx.Model(&model.ChannelModelPriceTier{}).Where("id = ? AND updated_at = ? AND price_version = ?", tier.ID, tier.UpdatedAt, tier.PriceVersion).
						Updates(map[string]any{"cost_unit_price_microcredits": tier.CostPricing.UnitPriceMicrocredits, "unit_price_microcredits": tier.UnitPriceMicrocredits, "price_version": tier.PriceVersion + 1})
					if result.Error != nil {
						return result.Error
					}
					if result.RowsAffected != 1 {
						return ErrChannelModelPriceConflict
					}
				}
			}
			for _, item := range added {
				if err := tx.Create(&item).Error; err != nil {
					return err
				}
			}
			if len(changed) > 0 || len(added) > 0 {
				if err := refreshChannelModelNames(tx, run.ChannelID, time.Now()); err != nil {
					return err
				}
			}
		}
		if err := tx.Model(&model.ChannelSyncRun{}).Where("id = ? AND status = ?", run.ID, "running").
			Updates(map[string]any{"status": run.Status, "summary": run.Summary, "finished_at": run.FinishedAt}).Error; err != nil {
			return err
		}
		return tx.Model(&job).Update("lease_expires_at", nil).Error
	})
}
