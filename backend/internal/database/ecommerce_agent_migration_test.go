package database

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func TestEcommerceAgentSchemaMigration83(t *testing.T) {
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: filepath.Join(t.TempDir(), "schema.db")}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { sqlDB, _ := db.DB(); _ = sqlDB.Close() }()
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{}, &model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing agent table %T", table)
		}
	}
	if !db.Migrator().HasColumn(&model.EcommerceKnowledgeEntry{}, "KnowledgeDomain") {
		t.Fatal("missing ecommerce knowledge domain column after schema migration")
	}
	if !db.Migrator().HasIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain") {
		t.Fatal("missing ecommerce knowledge domain index after schema migration")
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

func TestEcommerceAgentSchemaUpgradeFrom82PreservesMigrationHistory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "upgrade.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	assertSchemaUpgradeFrom82(t, db)
}

func TestPostgresSchemaUpgradeFrom82PreservesMigrationHistory(t *testing.T) {
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
	schema := fmt.Sprintf("upstream_upgrade_82_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error; err != nil {
			t.Error(err)
		}
	})
	testDSN, err := postgresDSNWithSearchPath(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assertSchemaUpgradeFrom82(t, db)
}

func assertSchemaUpgradeFrom82(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 82 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	ecommerceModels := []any{
		&model.EcommerceProject{}, &model.EcommerceKnowledgeSource{},
		&model.EcommerceKnowledgeEntry{}, &model.EcommerceCreativeRecommendation{},
		&model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{},
		&model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{},
		&model.ArkPortraitSession{}, &model.ArkPortraitGroup{}, &model.ArkPortraitAsset{}, &model.ArkPortraitGroupGrant{},
		&model.PoseLibrarySource{}, &model.PoseLibraryItem{}, &model.InspirationFeedEntry{},
		&model.EmailLog{}, &model.UserNotificationSetting{},
	}
	// The baseline uses current models; remove new tables to restore the deployed v82 schema.
	if err := db.Migrator().DropTable(ecommerceModels...); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"ChargeAmountFen", "ChargeCurrency", "ExchangeRateMicros", "PaymentMethod"} {
		if err := db.Migrator().DropColumn(&model.PaymentOrder{}, field); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO payment_orders (id,user_id,idempotency_key,merchant_order_no,amount_fen,currency,status) VALUES ('legacy-charge','owner','legacy-key','legacy-merchant',1234,'CNY','credited')`).Error; err != nil {
		t.Fatal(err)
	}
	for _, target := range []struct {
		entity any
		field  string
	}{
		{&model.DramaCast{}, "ImagePrompt"}, {&model.DramaSegment{}, "ReferenceImagesJSON"}, {&model.DramaSegment{}, "AudioCastIDsJSON"},
	} {
		if err := db.Migrator().DropColumn(target.entity, target.field); err != nil {
			t.Fatal(err)
		}
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	var legacy schemaMigration
	if err := db.First(&legacy, "version = ?", 82).Error; err != nil {
		t.Fatal(err)
	}
	if legacy.Name != "drama_cast_voice_looks" || legacy.Checksum != "sha256:drama-cast-voice-looks-v82-20261103" {
		t.Fatalf("v82 migration identity changed: %+v", legacy)
	}
	cast := model.DramaCast{ID: "existing-look", ProjectID: "existing-drama", Kind: "character", ParentID: "existing-character", LookName: "formal", LookFromChapter: 2, LookToChapter: 5, VoiceProfileID: "existing-voice", VoiceSampleResourceID: "existing-audio"}
	if err := db.Omit("ImagePrompt").Create(&cast).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&cast, "id = ?", cast.ID).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after []schemaMigration
	if err := db.Where("version <= ?", 82).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("existing migration ledger changed")
	}
	for _, table := range ecommerceModels {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing ecommerce table %T after upgrading from v82", table)
		}
	}
	if !db.Migrator().HasColumn(&model.EcommerceKnowledgeEntry{}, "KnowledgeDomain") || !db.Migrator().HasIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain") {
		t.Fatal("missing ecommerce knowledge domain column or index")
	}
	var added schemaMigration
	if err := db.First(&added, "version = ?", 83).Error; err != nil {
		t.Fatal(err)
	}
	if added.Name != "ecommerce_agent_and_knowledge" || added.Checksum != "sha256:ecommerce-agent-and-knowledge-v79-20261101" {
		t.Fatalf("unexpected v83 migration identity: %+v", added)
	}
	var stored model.DramaCast
	if err := db.First(&stored, "id = ?", cast.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cast, stored) {
		t.Fatal("existing drama voice or look data changed")
	}
	var charge model.PaymentOrder
	if err := db.First(&charge, "id = ?", "legacy-charge").Error; err != nil || charge.AmountFen != 1234 || charge.ChargeAmountFen != 1234 || charge.ChargeCurrency != "CNY" || charge.Status != "credited" {
		t.Fatalf("historical payment changed or charge not backfilled: %+v, %v", charge, err)
	}
	for _, target := range []struct {
		entity any
		field  string
	}{
		{&model.DramaCast{}, "ImagePrompt"}, {&model.DramaSegment{}, "ReferenceImagesJSON"}, {&model.DramaSegment{}, "AudioCastIDsJSON"},
	} {
		if !db.Migrator().HasColumn(target.entity, target.field) {
			t.Fatalf("missing upgraded field %s", target.field)
		}
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != 96 {
		t.Fatalf("unexpected upgraded schema: %+v, %v", status, err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}
