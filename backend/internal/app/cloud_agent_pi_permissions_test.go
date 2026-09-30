package app

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentPermissionsUseOwnedCanvasProject(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "canvas-1", UserID: "owner", Title: "Canvas", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	owner := svc.buildPermissionsConfig("owner", "canvas-1")
	if owner["canReadCanvas"] != true || owner["canWriteCanvas"] != true || owner["canCreateNodes"] != true {
		t.Fatalf("owner permissions: %+v", owner)
	}
	other := svc.buildPermissionsConfig("other", "canvas-1")
	if other["canReadCanvas"] != false || other["canWriteCanvas"] != false || other["canCreateNodes"] != false {
		t.Fatalf("other user permissions: %+v", other)
	}
}
