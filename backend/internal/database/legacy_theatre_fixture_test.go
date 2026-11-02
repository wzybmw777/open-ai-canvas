package database

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// restoreLegacyTheatreLedger reconstructs the deployed local numbering, whose
// theatre and channel-sync migrations shifted profile/canvas versions by four.
// Callers remove the post-boundary tables/columns that their upgrade tests cover.
func restoreLegacyTheatreLedger(t *testing.T, db *gorm.DB, through int64) {
	t.Helper()
	if err := db.Where("version >= ?", 41).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		version  int64
		name     string
		checksum string
	}{
		{41, "auth_phone_unique_index", "sha256:auth-phone-unique-index-v41-20260927"},
		{42, "resource_thumbnail", "sha256:resource-thumbnail-v42-20260928"},
		{43, "cloud_agent_pi_sessions", "sha256:cloud-agent-pi-sessions-v43-20260929"},
		{44, "topup_sale_strategies", "sha256:topup-sale-strategies-v44-20260930"},
		{45, "upload_reservations", "sha256:upload-reservations-v45-20261005"},
		{46, "skill_curation", "sha256:skill-curation-v46-20261005"},
		{47, "skill_curation_roots", "sha256:skill-curation-roots-v47-20261005"},
		{48, "theatre_works", "sha256:theatre-works-v48-20261008"},
		{49, "theatre_covers", "sha256:theatre-covers-v49-20261008"},
		{50, "theatre_short_dramas", "sha256:theatre-short-dramas-v50-20261008"},
		{51, "channel_proxy_url", "sha256:channel-proxy-url-v48-20261009"},
		{52, "banner_sort_order", "sha256:banner-sort-order-v49-20261010"},
		{53, "channel_sync_jobs", "sha256:channel-sync-jobs-v53"},
		{54, "canvas_mutation_receipts", "sha256:canvas-mutation-receipts-v54-20261011"},
		{55, "personal_profile_security", "sha256:personal-profile-security-v55-20261012"},
		{56, "user_avatar_presets", "sha256:user-avatar-presets-v56-20261012"},
		{57, "user_login_logs", "sha256:user-login-logs-v57"},
		{58, "workbench_tools_and_presets", "sha256:workbench-tools-presets-v58-20261014"},
		{59, "provider_catalog_source", "sha256:provider-catalog-source-v55"},
		{60, "sql_perf_indexes", "sha256:sql-perf-indexes-v56-20261016"},
		{61, "canvas_multi_session_sync", "sha256:canvas-multi-session-sync-v57"},
		{62, "rewards_membership", "sha256:rewards-membership-v62-20261019"},
		{63, "agent_memory_proposals", "sha256:agent-memory-proposals-v63"},
		{64, "channel_model_protocol_length", "sha256:channel-model-protocol-length-v64"},
		{65, "user_feedbacks", "sha256:user-feedbacks-v65-20261020"},
	} {
		if item.version > through {
			break
		}
		record := schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)}
		if err := db.Create(&record).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestPartialLegacyTheatreUpgradeRejectsChangedHistory(t *testing.T) {
	for _, field := range []string{"name", "checksum"} {
		t.Run(field, func(t *testing.T) {
			db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			restoreLegacyTheatreLedger(t, db, 54)
			if err := db.Migrator().DropTable(&model.UserAvatar{}); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&schemaMigration{}).Where("version = ?", 54).Update(field, "unknown").Error; err != nil {
				t.Fatal(err)
			}
			if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "不一致") {
				t.Fatalf("expected changed history to be rejected, got %v", err)
			}
			if db.Migrator().HasTable(&model.UserAvatar{}) {
				t.Fatal("rejected migration created profile tables")
			}
		})
	}
}

func TestPartialLegacyTheatreUpgradeRejectsLedgerGaps(t *testing.T) {
	for _, missing := range []int64{49, 53} {
		t.Run(fmt.Sprint(missing), func(t *testing.T) {
			db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			restoreLegacyTheatreLedger(t, db, 54)
			if err := db.Migrator().DropTable(&model.UserAvatar{}); err != nil {
				t.Fatal(err)
			}
			if err := db.Delete(&schemaMigration{}, "version = ?", missing).Error; err != nil {
				t.Fatal(err)
			}
			if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "缺少迁移记录") {
				t.Fatalf("expected ledger gap to be rejected, got %v", err)
			}
			var replayed int64
			if err := db.Model(&schemaMigration{}).Where("version = ?", missing).Count(&replayed).Error; err != nil {
				t.Fatal(err)
			}
			if replayed != 0 || db.Migrator().HasTable(&model.UserAvatar{}) {
				t.Fatal("rejected migration replayed history or created profile tables")
			}
		})
	}
}
