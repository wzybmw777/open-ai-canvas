package database

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func TestRuntimeTablesUpgradeFrom80PreservesLedgerAndRows(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assertRuntimeTablesUpgradeFrom80(t, db)
}

func TestPostgresRuntimeTablesUpgradeFrom80PreservesLedgerAndRows(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, _ := base.DB()
	t.Cleanup(func() { _ = baseSQL.Close() })
	schemaName := fmt.Sprintf("runtime_tables_migration_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec(`DROP SCHEMA IF EXISTS "` + schemaName + `" CASCADE`).Error; err != nil {
			t.Error(err)
		}
	})
	testDSN, err := postgresDSNWithSearchPath(dsn, schemaName)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assertRuntimeTablesUpgradeFrom80(t, db)
}

func assertRuntimeTablesUpgradeFrom80(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version > ?", 80).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{&model.TheatreWork{}, &model.TheatreEpisode{}, &model.ChannelSyncJob{}, &model.ChannelSyncRun{}} {
		if err := db.Migrator().DropTable(value); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Asset{ID: "kept", UserID: "owner", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	var before, after []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version <= ?", 80).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("forward migration rewrote the deployed ledger")
	}
	for _, value := range []any{&model.TheatreWork{}, &model.TheatreEpisode{}, &model.ChannelSyncJob{}, &model.ChannelSyncRun{}} {
		if !db.Migrator().HasTable(value) {
			t.Fatalf("missing runtime table for %T", value)
		}
	}
	var asset model.Asset
	if err := db.First(&asset, "id = ?", "kept").Error; err != nil || asset.UserID != "owner" {
		t.Fatalf("existing asset changed: %+v, %v", asset, err)
	}
}

func TestModelsIncludesTheatreAndChannelSyncTables(t *testing.T) {
	registered := map[reflect.Type]bool{}
	for _, value := range Models() {
		registered[reflect.TypeOf(value)] = true
	}
	for _, value := range []any{&model.TheatreWork{}, &model.TheatreEpisode{}, &model.ChannelSyncJob{}, &model.ChannelSyncRun{}} {
		if !registered[reflect.TypeOf(value)] {
			t.Errorf("missing model registration for %T", value)
		}
	}
}
