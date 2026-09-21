package app

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestExternalTopupShopSettings(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	member := &model.User{ID: "member"}

	initial, err := svc.AdminExternalTopupShop(admin)
	if err != nil || initial.Enabled || initial.URL != "https://wzyp.cn/shop/69G55K8Q" {
		t.Fatalf("default shop = %+v, err = %v", initial, err)
	}
	if _, err := svc.AdminExternalTopupShop(member); err == nil {
		t.Fatal("non-admin read succeeded")
	}
	if _, err := svc.UpdateExternalTopupShop(member, ExternalTopupShopSetting{Enabled: true, URL: initial.URL}); err == nil {
		t.Fatal("non-admin update succeeded")
	}
	for _, address := range []string{"http://example.com/shop", "javascript:alert(1)", "https://user:pass@example.com/", "https://example.com/#anchor", "https://example.com/\nheader: x"} {
		if _, err := svc.UpdateExternalTopupShop(admin, ExternalTopupShopSetting{Enabled: true, URL: address}); err == nil {
			t.Errorf("accepted invalid link %q", address)
		}
	}
	if _, err := svc.repo.SystemSetting(externalTopupShopSettingKey); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("invalid updates persisted setting: %v", err)
	}
	updated, err := svc.UpdateExternalTopupShop(admin, ExternalTopupShopSetting{Enabled: true, URL: " https://example.com/shop "})
	if err != nil || updated.URL != "https://example.com/shop" {
		t.Fatalf("updated shop = %+v, err = %v", updated, err)
	}
	reloaded, err := svc.AdminExternalTopupShop(admin)
	if err != nil || !reloaded.Enabled || reloaded.URL != updated.URL {
		t.Fatalf("persisted shop = %+v, err = %v", reloaded, err)
	}
	visible, err := svc.ExternalTopupShop(member)
	if err != nil || visible == nil || visible.URL != updated.URL {
		t.Fatalf("enabled public shop = %+v, err = %v", visible, err)
	}
	if _, err := svc.UpdateExternalTopupShop(admin, ExternalTopupShopSetting{URL: updated.URL}); err != nil {
		t.Fatal(err)
	}
	var audits []model.AdminAuditEvent
	if err := db.Find(&audits).Error; err != nil || len(audits) != 2 {
		t.Fatalf("shop configuration audits = %d, err = %v", len(audits), err)
	}
	for _, audit := range audits {
		if audit.Action != "payment_external_shop.update" || strings.Contains(audit.MetadataJSON, updated.URL) {
			t.Fatalf("unsafe shop audit = %+v", audit)
		}
	}
	shop, err := svc.ExternalTopupShop(member)
	if err != nil || shop != nil {
		t.Fatalf("disabled public shop = %+v, err = %v", shop, err)
	}
	if _, err := svc.ExternalTopupShop(nil); err == nil {
		t.Fatal("anonymous read succeeded")
	}
}
