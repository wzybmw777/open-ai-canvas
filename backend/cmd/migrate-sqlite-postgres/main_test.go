package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestMigrationListCoversSchemaModels(t *testing.T) {
	want := make(map[string]bool, len(database.Models()))
	cache := &sync.Map{}
	for _, value := range database.Models() {
		parsed, err := schema.Parse(value, cache, schema.NamingStrategy{})
		if err != nil {
			t.Fatal(err)
		}
		want[parsed.Table] = false
	}
	for _, migration := range migrations() {
		if _, exists := want[migration.name]; !exists {
			t.Fatalf("migration list contains unknown table %q", migration.name)
		}
		if want[migration.name] {
			t.Fatalf("migration list contains duplicate table %q", migration.name)
		}
		want[migration.name] = true
	}
	for table, covered := range want {
		if !covered {
			t.Errorf("migration list is missing table %q", table)
		}
	}
}

func TestCanvasHistoryCompositeKeyMigration(t *testing.T) {
	source, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-source?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	target, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:history-migration-target?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, db := range []*gorm.DB{source, target} {
		if err := db.AutoMigrate(&model.Resource{}, &model.CanvasSnapshotResource{}); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.Resource{ID: "resource"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	refs := []model.CanvasSnapshotResource{{SnapshotID: "b", ResourceID: "resource"}, {SnapshotID: "a", ResourceID: "resource"}}
	if err := source.Create(&refs).Error; err != nil {
		t.Fatal(err)
	}
	count, err := migrateTable[model.CanvasSnapshotResource]("canvas_snapshot_resources").run(source, target, true)
	if err != nil || count != 2 {
		t.Fatalf("history refs not copied/verified: %d %v", count, err)
	}
}

func TestRuntimeTablesCopyToPostgresPreservesRows(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := database.Open(database.Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, _ := base.DB()
	t.Cleanup(func() { _ = baseSQL.Close() })
	schemaName := fmt.Sprintf("runtime_table_copy_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec(`DROP SCHEMA IF EXISTS "` + schemaName + `" CASCADE`).Error; err != nil {
			t.Error(err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schemaName)
	parsed.RawQuery = query.Encode()
	target, err := database.Open(database.Config{Driver: "postgres", DSN: parsed.String()})
	if err != nil {
		t.Fatal(err)
	}
	targetSQL, _ := target.DB()
	t.Cleanup(func() { _ = targetSQL.Close() })
	source, err := database.Open(database.Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "source.db")})
	if err != nil {
		t.Fatal(err)
	}
	sourceSQL, _ := source.DB()
	t.Cleanup(func() { _ = sourceSQL.Close() })
	now := time.Date(2026, 10, 20, 12, 30, 45, 123456000, time.UTC)
	rows := []any{
		&model.ChannelSyncJob{ChannelID: "channel", Enabled: true, Script: "catalog", NextRunAt: &now, LastRunID: "sync", LeaseExpiresAt: &now, CreatedAt: now, UpdatedAt: now},
		&model.ChannelSyncRun{ID: "sync", ChannelID: "channel", Trigger: "manual", ActorID: "owner", Status: "succeeded", Summary: "保留同步记录", StartedAt: now, FinishedAt: &now},
		&model.TheatreWork{ID: "work", UserID: "owner", ResourceID: "video", CoverResourceID: "cover", Kind: model.TheatreWorkShortDrama, IsComplete: true, Title: "已发布短剧", Description: "保留简介", CreatedAt: now, UpdatedAt: now},
		&model.TheatreEpisode{ID: "episode", WorkID: "work", ResourceID: "episode-video", Number: 1, Title: "第一集", CreatedAt: now, UpdatedAt: now},
	}
	for _, db := range []*gorm.DB{source, target} {
		if err := db.AutoMigrate(rows...); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range rows {
		if err := source.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	want := map[string]bool{"channel_sync_jobs": false, "channel_sync_runs": false, "theatre_works": false, "theatre_episodes": false}
	for _, item := range migrations() {
		if _, included := want[item.name]; !included {
			continue
		}
		for _, copyRows := range []bool{true, false} {
			if count, err := item.run(source, target, copyRows); err != nil || count != 1 {
				t.Fatalf("table %s copy=%v: count=%d, error=%v", item.name, copyRows, count, err)
			}
		}
		want[item.name] = true
	}
	for name, copied := range want {
		if !copied {
			t.Errorf("runtime rows were not copied: %s", name)
		}
	}
}

func TestChannelWebsiteMigrationDependencyOrder(t *testing.T) {
	positions := make(map[string]int)
	for i, migration := range migrations() {
		positions[migration.name] = i
	}
	for _, dependency := range [][2]string{
		{"channel_websites", "model_channels"},
		{"model_channels", "channel_catalog_snapshots"},
		{"channel_websites", "channel_protocol_selections"},
		{"channel_models", "channel_protocol_selections"},
		{"users", "channel_protocol_selections"},
	} {
		parent, parentFound := positions[dependency[0]]
		child, childFound := positions[dependency[1]]
		if !parentFound || !childFound || parent >= child {
			t.Errorf("migration must copy %s before %s", dependency[0], dependency[1])
		}
	}
}
