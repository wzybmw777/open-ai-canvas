package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestTheatreDramaUpgradeFrom49KeepsVideosAndCovers(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.TheatreEpisode{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropIndex(&model.TheatreWork{}, "idx_theatre_works_kind"); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"kind", "is_complete"} {
		if err := db.Migrator().DropColumn(&model.TheatreWork{}, field); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version >= ?", 50).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO theatre_works(id,user_id,resource_id,cover_resource_id,title,description) VALUES ('existing','author','video','poster','作品','原简介')").Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var work model.TheatreWork
	if err := db.First(&work, "id = ?", "existing").Error; err != nil {
		t.Fatal(err)
	}
	if work.Kind != model.TheatreWorkVideo || work.IsComplete || work.ResourceID != "video" || work.CoverResourceID != "poster" || work.Title != "作品" || work.Description != "原简介" {
		t.Fatalf("migration changed work: %#v", work)
	}
	if !db.Migrator().HasTable(&model.TheatreEpisode{}) || !db.Migrator().HasIndex(&model.TheatreEpisode{}, "idx_theatre_episode_number") {
		t.Fatal("episode table or number index missing")
	}
	for _, episode := range []model.TheatreEpisode{{ID: "a", WorkID: "series", ResourceID: "video-one", Number: 1, Title: "第一集"}, {ID: "b", WorkID: "series", ResourceID: "video-two", Number: 1, Title: "重复集数"}} {
		err := db.Create(&episode).Error
		if episode.ID == "a" && err != nil {
			t.Fatal(err)
		}
		if episode.ID == "b" && err == nil {
			t.Fatal("duplicate episode numbers accepted")
		}
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != 50 {
		t.Fatalf("status=%#v, %v", status, err)
	}
}
