package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestTheatreSchemaUpgradeFrom47(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Asset{ID: "existing-asset", UserID: "author", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.TheatreWork{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version >= ?", 48).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema = %#v, %v", status, err)
	}
	if !db.Migrator().HasTable(&model.TheatreWork{}) || !db.Migrator().HasIndex(&model.TheatreWork{}, "idx_theatre_works_resource_id") {
		t.Fatal("theatre table or unique resource index missing")
	}
	if err := db.Create(&model.TheatreWork{ID: "first", UserID: "author", ResourceID: "video", Title: "作品"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.TheatreWork{ID: "second", UserID: "author", ResourceID: "video", Title: "重复"}).Error; err == nil {
		t.Fatal("duplicate video publication must violate the unique index")
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var assets, works int64
	if err := db.Model(&model.Asset{}).Where("id = ?", "existing-asset").Count(&assets).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.TheatreWork{}).Count(&works).Error; err != nil {
		t.Fatal(err)
	}
	if assets != 1 || works != 1 {
		t.Fatalf("migration changed business records: assets=%d works=%d", assets, works)
	}
}

func TestTheatreCoverUpgradePreservesPublishedWorks(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropIndex(&model.TheatreWork{}, "idx_theatre_works_cover_resource_id"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.TheatreWork{}, "cover_resource_id"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version >= ?", 49).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO theatre_works (id,user_id,resource_id,title,description) VALUES ('existing','author','video','已发布作品','保留简介')").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var work model.TheatreWork
	if err := db.First(&work, "id = ?", "existing").Error; err != nil {
		t.Fatal(err)
	}
	if work.Title != "已发布作品" || work.Description != "保留简介" || work.ResourceID != "video" || work.CoverResourceID != "" {
		t.Fatalf("migration changed published work: %#v", work)
	}
	if !db.Migrator().HasIndex(&model.TheatreWork{}, "idx_theatre_works_cover_resource_id") {
		t.Fatal("cover reference index missing")
	}
}
