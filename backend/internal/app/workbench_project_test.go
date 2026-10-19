package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/model"
)

func TestWorkbenchProjectAdmission(t *testing.T) {
	s, db := newFeatureAvailabilityTestService(t)
	if err := db.AutoMigrate(&model.Project{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"imageWorkbenchEnabled":true,"videoWorkbenchEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	projects := []model.Project{
		{ID: "active", UserID: "owner", Name: "Active", Status: model.ProjectStatusActive},
		{ID: "archived", UserID: "owner", Name: "Archived", Status: model.ProjectStatusArchived},
		{ID: "other", UserID: "other-owner", Name: "Other", Status: model.ProjectStatusActive},
	}
	if err := db.Create(&projects).Error; err != nil {
		t.Fatal(err)
	}
	if project, err := s.requireWorkbenchProject("owner", " active "); err != nil || project.ID != "active" {
		t.Fatalf("owned active project rejected: %v, %v", project, err)
	}
	for _, tc := range []struct {
		id     string
		status int
	}{{"", 400}, {"missing", 404}, {"other", 404}, {"archived", 400}} {
		for _, kind := range []string{WorkbenchKindImage, WorkbenchKindVideo} {
			t.Run(kind+"/"+tc.id, func(t *testing.T) {
				_, dedicatedErr := s.CreateWorkbenchTask("owner", WorkbenchTaskInput{ProjectID: tc.id, Kind: kind, Prompt: "test"}, "", "")
				_, genericErr := s.CreateTask("owner", CreateTaskRequest{ProjectID: tc.id, Type: "canvas_" + kind, Prompt: "test", Input: map[string]any{"metadata": map[string]any{"source": "workbench"}}})
				operation := "image"
				if kind == WorkbenchKindVideo {
					operation = "video_edit"
				}
				_, spoofedCleanupErr := s.CreateTask("owner", CreateTaskRequest{ProjectID: tc.id, Type: "canvas_" + kind, Operation: operation, Prompt: "test", Input: map[string]any{"metadata": map[string]any{"source": "workbench", "workbenchKind": kind, "edit": "remove_watermark"}}})
				for path, err := range map[string]error{"dedicated": dedicatedErr, "generic": genericErr, "spoofed-cleanup": spoofedCleanupErr} {
					var apiErr *AuthError
					if !errors.As(err, &apiErr) || apiErr.Status != tc.status {
						t.Fatalf("%s error = %v, want status %d", path, err, tc.status)
					}
				}
			})
		}
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected requests created tasks: count=%d err=%v", count, err)
	}
	for _, id := range []string{"other", "missing"} {
		_, err := s.WorkbenchTasks("owner", WorkbenchKindImage, id, false, 50)
		var apiErr *AuthError
		if !errors.As(err, &apiErr) || apiErr.Status != 404 {
			t.Fatalf("list project %q: %v", id, err)
		}
	}
}
