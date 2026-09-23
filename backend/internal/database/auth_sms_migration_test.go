package database

import (
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestAuthSMSUpgradeFromV34PreservesAccounts(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "upgrade.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	// 还原旧库边界，不能用当前 Models() 提前创建待验证的新字段与表。
	for _, statement := range []string{
		`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, password_hash TEXT)`,
		`INSERT INTO users VALUES ('existing', 'existing-user', 'preserved-hash')`,
		`CREATE TABLE email_verification_codes (id TEXT PRIMARY KEY, code_hash TEXT)`,
		`INSERT INTO email_verification_codes VALUES ('existing-code', 'preserved-code-hash')`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version <= 34 {
			if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now()}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var user model.User
	if err := db.First(&user, "id = ?", "existing").Error; err != nil {
		t.Fatal(err)
	}
	if user.Username != "existing-user" || user.PasswordHash != "preserved-hash" || user.Phone != "" || user.EmailVerifiedAt != nil || user.PhoneVerifiedAt != nil {
		t.Fatal("migration changed account data or fabricated verification")
	}
	var code model.EmailVerificationCode
	if err := db.First(&code, "id = ?", "existing-code").Error; err != nil {
		t.Fatal(err)
	}
	if code.CodeHash != "preserved-code-hash" || code.Attempts != 0 {
		t.Fatal("migration changed existing verification code")
	}
	for _, entity := range []any{&model.AuthVerification{}, &model.NotificationQuota{}, &model.SMSChannel{}, &model.SMSRecord{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatalf("missing notification table for %T", entity)
		}
	}
	for _, field := range []string{"Phone", "EmailVerifiedAt", "PhoneVerifiedAt"} {
		if !db.Migrator().HasColumn(&model.User{}, field) {
			t.Fatalf("missing user field %s", field)
		}
	}
	if !db.Migrator().HasColumn(&model.EmailVerificationCode{}, "Attempts") {
		t.Fatal("missing verification attempt counter")
	}
}
