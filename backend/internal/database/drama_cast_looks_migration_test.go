package database

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// Missing the forward migration must not leave old casts unreadable or rewrite deployed history.
func TestDramaCastLooksUpgradeFrom81PreservesLedgerAndContent(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			config := Config{Driver: driver, DSN: ":memory:"}
			if driver == "postgres" {
				dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
				if dsn == "" {
					t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
				}
				base, err := Open(Config{Driver: driver, DSN: dsn})
				if err != nil {
					t.Fatal(err)
				}
				baseSQL, _ := base.DB()
				t.Cleanup(func() { _ = baseSQL.Close() })
				schema := fmt.Sprintf("cast_looks_migration_%d", time.Now().UnixNano())
				if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if err := base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error; err != nil {
						t.Error(err)
					}
				})
				config.DSN, err = postgresDSNWithSearchPath(dsn, schema)
				if err != nil {
					t.Fatal(err)
				}
			}
			db, err := Open(config)
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			if err := db.Where("version > ?", 81).Delete(&schemaMigration{}).Error; err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"VoiceProfileID", "VoiceSampleResourceID", "ParentID", "LookName", "LookFromChapter", "LookToChapter"} {
				if err := db.Migrator().DropColumn(&model.DramaCast{}, field); err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Migrator().DropColumn(&model.DramaShot{}, "LookCastIDsJSON"); err != nil {
				t.Fatal(err)
			}
			if err := db.Exec("INSERT INTO drama_casts (id,project_id,kind,name,appearance,voice_instructions) VALUES ('cast-kept','project-kept','character','旧角色','旧外观','旧声线')").Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec("INSERT INTO drama_shots (id,project_id,episode_id,cast_ids_json,dialogue) VALUES ('shot-kept','project-kept','episode-kept','[\"cast-kept\"]','旧台词')").Error; err != nil {
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
			if !db.Migrator().HasColumn(&model.DramaCast{}, "VoiceProfileID") || !db.Migrator().HasColumn(&model.DramaShot{}, "LookCastIDsJSON") {
				t.Fatal("v81 upgrade did not add cast voices and shot looks")
			}
			if err := db.Where("version <= ?", 81).Order("version").Find(&after).Error; err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("deployed migration ledger changed: %v", err)
			}
			var cast model.DramaCast
			if err := db.First(&cast, "id = ?", "cast-kept").Error; err != nil || cast.Name != "旧角色" || cast.Appearance != "旧外观" || cast.VoiceInstructions != "旧声线" || cast.ProjectID != "project-kept" || cast.ParentID != "" || cast.VoiceProfileID != "" || cast.LookFromChapter != 0 || cast.LookToChapter != 0 {
				t.Fatalf("cast changed after upgrade: %+v, %v", cast, err)
			}
			var shot model.DramaShot
			if err := db.First(&shot, "id = ?", "shot-kept").Error; err != nil || shot.Dialogue != "旧台词" || shot.CastIDsJSON != `["cast-kept"]` || shot.LookCastIDsJSON != "" {
				t.Fatalf("shot changed after upgrade: %+v, %v", shot, err)
			}
			var nulls int64
			if err := db.Model(&model.DramaCast{}).Where("voice_profile_id IS NULL OR voice_sample_resource_id IS NULL OR parent_id IS NULL OR look_name IS NULL OR look_from_chapter IS NULL OR look_to_chapter IS NULL").Count(&nulls).Error; err != nil || nulls != 0 {
				t.Fatalf("legacy cast defaults not initialized: %d, %v", nulls, err)
			}
			if !db.Migrator().HasIndex(&model.DramaCast{}, "ParentID") {
				t.Fatal("missing cast parent index")
			}
			status, err := ReadSchemaStatus(db)
			if err != nil || !status.Ready || status.Current != 82 {
				t.Fatalf("unexpected upgraded schema: %+v, %v", status, err)
			}
		})
	}
}
