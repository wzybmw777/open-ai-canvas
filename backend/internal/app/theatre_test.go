package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestTheatrePublicationAndOwnership(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	s := New(repository.New(db), t.TempDir())
	for _, record := range []any{
		&model.User{ID: "author", Username: "author", DisplayName: "导演", Status: model.UserStatusActive},
		&model.User{ID: "viewer", Username: "viewer", Status: model.UserStatusActive},
		&model.User{ID: "blocked", Username: "blocked", Status: model.UserStatusDisabled},
		&model.Resource{ID: "video", UserID: "author", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady, Size: 123, DurationMs: 5000},
		&model.Resource{ID: "image", UserID: "author", Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady},
		&model.Resource{ID: "pending", UserID: "author", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusPending},
		&model.Resource{ID: "spoofed", UserID: "author", Kind: "video", MimeType: "text/html", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}

	assertStatus := func(err error, status int) {
		t.Helper()
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != status {
			t.Fatalf("error = %v, want status %d", err, status)
		}
	}
	request := TheatreWorkRequest{ResourceID: "video", Title: "  首映  ", Description: "  完成剪辑  "}
	_, err := s.CreateTheatreWork("", request)
	assertStatus(err, 401)
	_, err = s.CreateTheatreWork("viewer", request)
	assertStatus(err, 404)
	_, err = s.CreateTheatreWork("blocked", request)
	assertStatus(err, 403)
	for _, resourceID := range []string{"image", "pending", "spoofed", ""} {
		_, err := s.CreateTheatreWork("author", TheatreWorkRequest{ResourceID: resourceID, Title: "test"})
		assertStatus(err, 400)
	}
	for _, title := range []string{"   ", strings.Repeat("剧", 121)} {
		_, err := s.CreateTheatreWork("author", TheatreWorkRequest{ResourceID: "video", Title: title})
		assertStatus(err, 400)
	}
	work, err := s.CreateTheatreWork("author", request)
	if err != nil {
		t.Fatal(err)
	}
	if work.Title != "首映" || work.Description != "完成剪辑" {
		t.Fatalf("metadata = %#v", work)
	}
	repeat, err := s.CreateTheatreWork("author", request)
	if err != nil || repeat.ID != work.ID {
		t.Fatalf("duplicate publication = %#v, %v", repeat, err)
	}

	page, err := s.TheatreWorks("viewer", "首映", false, 1, 12, "")
	if err != nil || page.Total != 1 || len(page.Works) != 1 || page.Works[0].AuthorName != "导演" || page.Works[0].DurationMs != 5000 {
		t.Fatalf("shared feed = %#v, %v", page, err)
	}
	mine, err := s.TheatreWorks("viewer", "", true, 1, 12, "")
	if err != nil || mine.Total != 0 {
		t.Fatalf("mine = %#v, %v", mine, err)
	}
	_, err = s.TheatreWorks("", "", false, 1, 12, "")
	assertStatus(err, 401)
	_, err = s.TheatreWorks("viewer", "", false, 0, 12, "")
	assertStatus(err, 400)
	assertStatus(s.UpdateTheatreWork("viewer", work.ID, request), 403)
	assertStatus(s.DeleteTheatreWork("viewer", work.ID), 403)
	if err := s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "新标题", Description: ""}); err != nil {
		t.Fatal(err)
	}
	updated, _ := s.repo.TheatreWork(work.ID)
	if updated.Title != "新标题" || updated.Description != "" {
		t.Fatalf("updated = %#v", updated)
	}

	snapshot, err := s.repo.ResourceReferenceSnapshot("author", "", []string{"video"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, reference := range snapshot.Direct {
		if reference.Kind == "卓越剧场" && reference.ResourceID == "video" {
			found = true
		}
	}
	if !found {
		t.Fatal("published video missing from resource references")
	}
	resource, _ := s.repo.ResourceForUser("author", "video")
	if err := s.repo.DeleteDetachedResources([]model.Resource{*resource}, nil); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatalf("cleanup must preserve published videos: %v", err)
	}
	if err := s.repo.DeleteAdminResources([]model.Resource{*resource}, nil, []model.AdminAuditEvent{{ID: "theatre-audit"}}); !errors.Is(err, repository.ErrAdminResourceStillReferenced) {
		t.Fatalf("admin deletion must preserve published videos: %v", err)
	}
	asset := &model.Asset{ID: "asset", UserID: "author", PayloadJSON: `{"kind":"video","data":{"storageKey":"resource:video"}}`, CreatedAt: time.Now()}
	if err := db.Create(asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.DeleteAssetAndResources("author", "asset", []string{"video"}, nil, true); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatalf("asset deletion must preserve published videos: %v", err)
	}
	assertStatus(s.PurgeUserAssets("author", []string{"asset"}), 400)
	if _, err := s.repo.AssetForUser("author", "asset"); err != nil {
		t.Fatalf("blocked deletion must preserve the asset: %v", err)
	}
	if err := s.DeleteTheatreWork("author", work.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Resource("author", "video"); err != nil {
		t.Fatalf("unpublishing must preserve owned media: %v", err)
	}
	_, err = s.PrepareTheatreDelivery("viewer", work.ID, "")
	assertStatus(err, 404)
}

func TestTheatreCoverOwnershipReplacementAndReferenceProtection(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	s := New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = s.Close() })
	for _, record := range []any{
		&model.User{ID: "author", Username: "author", Status: model.UserStatusActive},
		&model.User{ID: "viewer", Username: "viewer", Status: model.UserStatusActive},
		&model.Resource{ID: "video", UserID: "author", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady, Size: 10},
		&model.Resource{ID: "cover", UserID: "author", Kind: "image", MimeType: "image/jpeg", Status: model.ResourceStatusReady, Size: 10},
		&model.Resource{ID: "replacement", UserID: "author", Kind: "image", MimeType: "image/webp", Status: model.ResourceStatusReady, Size: 20},
		&model.Resource{ID: "foreign", UserID: "viewer", Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady, Size: 10},
		&model.Resource{ID: "pending-cover", UserID: "author", Kind: "image", MimeType: "image/jpeg", Status: model.ResourceStatusPending, Size: 10},
		&model.Resource{ID: "svg-cover", UserID: "author", Kind: "image", MimeType: "image/svg+xml", Status: model.ResourceStatusReady, Size: 10},
		&model.Resource{ID: "large-cover", UserID: "author", Kind: "image", MimeType: "image/jpeg", Status: model.ResourceStatusReady, Size: (10 << 20) + 1},
		&model.Resource{ID: "empty-cover", UserID: "author", Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	assertStatus := func(err error, status int) {
		t.Helper()
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != status {
			t.Fatalf("error = %v, want status %d", err, status)
		}
	}
	for _, test := range []struct {
		id     string
		status int
	}{
		{"missing", 404}, {"foreign", 404}, {"video", 400}, {"pending-cover", 400}, {"svg-cover", 400}, {"large-cover", 400}, {"empty-cover", 400},
	} {
		_, err := s.CreateTheatreWork("author", TheatreWorkRequest{ResourceID: "video", Title: "作品", CoverResourceID: &test.id})
		assertStatus(err, test.status)
	}
	coverID := " cover "
	work, err := s.CreateTheatreWork("author", TheatreWorkRequest{ResourceID: "video", Title: "作品", CoverResourceID: &coverID})
	if err != nil || work.CoverResourceID != "cover" {
		t.Fatalf("published cover = %#v, %v", work, err)
	}
	page, err := s.TheatreWorks("viewer", "", false, 1, 12, "")
	if err != nil || len(page.Works) != 1 || page.Works[0].CoverResourceID != "cover" {
		t.Fatalf("shared cover metadata = %#v, %v", page, err)
	}
	assertStatus(s.UpdateTheatreWork("viewer", work.ID, TheatreWorkRequest{Title: "作品", CoverResourceID: &coverID}), 403)
	if err := s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "保留封面"}); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.TheatreWork(work.ID)
	if stored.CoverResourceID != "cover" {
		t.Fatal("omitted cover must preserve the current image")
	}
	snapshot, err := s.repo.ResourceReferenceSnapshot("author", "", []string{"cover"})
	if err != nil || len(snapshot.Direct) != 1 || snapshot.Direct[0].ResourceID != "cover" || snapshot.Direct[0].Kind != "卓越剧场封面" {
		t.Fatalf("cover reference = %#v, %v", snapshot, err)
	}
	cover, _ := s.repo.ResourceForUser("author", "cover")
	if err := s.repo.DeleteDetachedResources([]model.Resource{*cover}, nil); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatalf("cleanup must protect cover: %v", err)
	}
	if err := s.repo.DeleteAdminResources([]model.Resource{*cover}, nil, []model.AdminAuditEvent{{ID: "cover-audit"}}); !errors.Is(err, repository.ErrAdminResourceStillReferenced) {
		t.Fatalf("admin deletion must protect cover: %v", err)
	}
	if err := db.Create(&model.Asset{ID: "cover-asset", UserID: "author", PayloadJSON: `{"kind":"image","data":{"storageKey":"resource:cover"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	assertStatus(s.PurgeUserAssets("author", []string{"cover-asset"}), 400)
	replacement := "replacement"
	if err := s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "换封面", CoverResourceID: &replacement}); err != nil {
		t.Fatal(err)
	}
	snapshot, err = s.repo.ResourceReferenceSnapshot("author", "", []string{"cover", "replacement"})
	if err != nil || len(snapshot.Direct) != 1 || snapshot.Direct[0].ResourceID != replacement {
		t.Fatalf("replacement reference = %#v, %v", snapshot, err)
	}
	if err := s.PurgeUserAssets("author", []string{"cover-asset"}); err != nil {
		t.Fatalf("replaced cover can be removed: %v", err)
	}
	empty := ""
	if err := s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "移除封面", CoverResourceID: &empty}); err != nil {
		t.Fatal(err)
	}
	stored, _ = s.repo.TheatreWork(work.ID)
	if stored.CoverResourceID != "" || stored.ResourceID != "video" {
		t.Fatalf("clear cover changed video: %#v", stored)
	}
	_, err = s.PrepareTheatreCoverDelivery("viewer", work.ID, "")
	assertStatus(err, 404)
}
