package app

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestTheatreDramaEpisodesOwnershipEditingAndCleanup(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	s := New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = s.Close() })
	for _, value := range []any{
		&model.User{ID: "author", Username: "author", Status: model.UserStatusActive},
		&model.User{ID: "viewer", Username: "viewer", Status: model.UserStatusActive},
		&model.User{ID: "blocked", Username: "blocked", Status: model.UserStatusDisabled},
		&model.Resource{ID: "one", UserID: "author", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady, Size: 11, DurationMs: 1000},
		&model.Resource{ID: "two", UserID: "author", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady, Size: 22, DurationMs: 2000},
		&model.Resource{ID: "three", UserID: "author", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady, Size: 33, DurationMs: 3000},
		&model.Resource{ID: "foreign", UserID: "viewer", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady},
		&model.Resource{ID: "pending", UserID: "author", Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusPending},
		&model.Resource{ID: "spoofed", UserID: "author", Kind: "video", MimeType: "text/html", Status: model.ResourceStatusReady},
		&model.Resource{ID: "cover", UserID: "author", Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady, Size: 10},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	status := func(err error, want int) {
		t.Helper()
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != want {
			t.Fatalf("error=%v, want status=%d", err, want)
		}
	}
	inputs := []TheatreEpisodeInput{{ResourceID: "one", Title: "  开场  "}, {ResourceID: "two"}}
	cover := "cover"
	request := TheatreWorkRequest{Kind: model.TheatreWorkShortDrama, Title: "短剧", Description: "故事", Episodes: &inputs, CoverResourceID: &cover}
	_, err := s.CreateTheatreWork("", request)
	status(err, 401)
	_, err = s.CreateTheatreWork("viewer", request)
	status(err, 404)
	_, err = s.CreateTheatreWork("blocked", request)
	status(err, 403)
	for _, check := range []struct {
		inputs []TheatreEpisodeInput
		want   int
	}{
		{nil, 400}, {[]TheatreEpisodeInput{{ResourceID: "one"}, {ResourceID: "one"}}, 400},
		{[]TheatreEpisodeInput{{ResourceID: "foreign"}}, 404}, {[]TheatreEpisodeInput{{ResourceID: "missing"}}, 404},
		{[]TheatreEpisodeInput{{ResourceID: "pending"}}, 400}, {[]TheatreEpisodeInput{{ResourceID: "spoofed"}}, 400},
		{[]TheatreEpisodeInput{{ResourceID: "cover"}}, 400},
	} {
		invalid := request
		invalid.Episodes = &check.inputs
		_, err := s.CreateTheatreWork("author", invalid)
		status(err, check.want)
	}
	work, err := s.CreateTheatreWork("author", request)
	if err != nil {
		t.Fatal(err)
	}
	if work.Kind != model.TheatreWorkShortDrama || work.ResourceID != "one" || work.IsComplete {
		t.Fatalf("work=%#v", work)
	}
	repeated, err := s.CreateTheatreWork("author", request)
	if err != nil || repeated.ID != work.ID {
		t.Fatalf("repeat=%#v, %v", repeated, err)
	}
	detail, err := s.TheatreWorkDetail("viewer", work.ID)
	if err != nil || len(detail.Episodes) != 2 || detail.Work.EpisodeCount != 2 {
		t.Fatalf("detail=%#v, %v", detail, err)
	}
	if detail.Episodes[0].Title != "开场" || detail.Episodes[1].Title != "第2集" || detail.Episodes[1].Number != 2 || detail.Episodes[1].DurationMs != 2000 {
		t.Fatalf("episodes=%#v", detail.Episodes)
	}
	oneID, twoID := detail.Episodes[0].ID, detail.Episodes[1].ID
	_, err = s.TheatreWorkDetail("", work.ID)
	status(err, 401)
	_, err = s.PrepareTheatreEpisodeDelivery("viewer", work.ID, "not-in-this-work", "")
	status(err, 404)
	page, err := s.TheatreWorks("viewer", "", false, 1, 12, model.TheatreWorkShortDrama)
	if err != nil || page.Total != 1 || page.Works[0].EpisodeCount != 2 {
		t.Fatalf("drama feed=%#v, %v", page, err)
	}
	page, err = s.TheatreWorks("viewer", "", false, 1, 12, model.TheatreWorkVideo)
	if err != nil || page.Total != 0 {
		t.Fatalf("video feed=%#v, %v", page, err)
	}
	_, err = s.TheatreWorks("viewer", "", false, 1, 12, "invalid")
	status(err, 400)
	status(s.UpdateTheatreWork("viewer", work.ID, request), 403)
	status(s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "短剧", Episodes: &inputs}), 400)
	empty := []TheatreEpisodeInput{}
	status(s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "短剧", Episodes: &empty, ExpectedUpdatedAt: &work.UpdatedAt}), 400)
	complete := true
	if err := s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "完结短剧", IsComplete: &complete}); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.TheatreWork(work.ID)
	detail, _ = s.TheatreWorkDetail("viewer", work.ID)
	if !stored.IsComplete || len(detail.Episodes) != 2 || detail.Episodes[1].ID != twoID {
		t.Fatal("metadata-only edit changed episodes")
	}
	reordered := []TheatreEpisodeInput{{ResourceID: "two", Title: "新的开场"}, {ResourceID: "one", Title: "第二集"}, {ResourceID: "three", Title: "新增一集"}}
	edit := TheatreWorkRequest{Title: "更新短剧", Episodes: &reordered, ExpectedUpdatedAt: &stored.UpdatedAt}
	if err := s.UpdateTheatreWork("author", work.ID, edit); err != nil {
		t.Fatal(err)
	}
	detail, err = s.TheatreWorkDetail("viewer", work.ID)
	if err != nil || len(detail.Episodes) != 3 || detail.Work.ResourceID != "two" || detail.Work.CoverResourceID != cover || detail.Episodes[0].ID != twoID || detail.Episodes[1].ID != oneID {
		t.Fatalf("reorder=%#v, %v", detail, err)
	}
	status(s.UpdateTheatreWork("author", work.ID, edit), 409)
	for _, resourceID := range []string{"one", "three"} {
		snapshot, err := s.repo.ResourceReferenceSnapshot("author", "", []string{resourceID})
		if err != nil {
			t.Fatal(err)
		}
		if len(snapshot.Direct) != 1 || snapshot.Direct[0].Kind != "卓越短剧" {
			t.Fatalf("episode reference=%#v", snapshot.Direct)
		}
		resource, _ := s.repo.ResourceForUser("author", resourceID)
		if err := s.repo.DeleteDetachedResources([]model.Resource{*resource}, nil); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
			t.Fatalf("cleanup lost episode: %v", err)
		}
		if err := s.repo.DeleteAdminResources([]model.Resource{*resource}, nil, []model.AdminAuditEvent{{ID: "episode-audit-" + resourceID}}); !errors.Is(err, repository.ErrAdminResourceStillReferenced) {
			t.Fatalf("admin deletion lost episode: %v", err)
		}
	}
	asset := &model.Asset{ID: "episode-asset", UserID: "author", PayloadJSON: `{"kind":"video","data":{"storageKey":"resource:three"}}`, CreatedAt: time.Now()}
	if err := db.Create(asset).Error; err != nil {
		t.Fatal(err)
	}
	status(s.PurgeUserAssets("author", []string{asset.ID}), 400)
	if err := s.repo.DeleteAssetAndResources("author", asset.ID, []string{"three"}, nil, true); !errors.Is(err, repository.ErrResourceCleanupStillReferenced) {
		t.Fatalf("asset deletion lost episode: %v", err)
	}
	trimmed := reordered[:2]
	if err := s.UpdateTheatreWork("author", work.ID, TheatreWorkRequest{Title: "保留两集", Episodes: &trimmed, ExpectedUpdatedAt: &detail.Work.UpdatedAt}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.repo.ResourceReferenceSnapshot("author", "", []string{"three"})
	if err != nil || len(snapshot.Direct) != 0 {
		t.Fatalf("removed episode still directly referenced=%#v, %v", snapshot, err)
	}
	if err := s.DeleteTheatreWork("author", work.ID); err != nil {
		t.Fatal(err)
	}
	var remaining int64
	db.Model(&model.TheatreEpisode{}).Where("work_id = ?", work.ID).Count(&remaining)
	if remaining != 0 {
		t.Fatal("unpublishing left episode rows")
	}
	_, err = s.TheatreWorkDetail("viewer", work.ID)
	status(err, 404)
	_, err = s.PrepareTheatreEpisodeDelivery("viewer", work.ID, twoID, "")
	status(err, 404)
	if _, err := s.Resource("author", "one"); err != nil {
		t.Fatal("unpublishing deleted the private upload")
	}
}
