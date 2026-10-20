package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/model"
)

func TestWorkbenchProjectAdmission(t *testing.T) {
	s, db := newFeatureAvailabilityTestService(t)
	if err := db.AutoMigrate(&model.Project{}, &model.CanvasProject{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"imageWorkbenchEnabled":true,"videoWorkbenchEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	projects := []model.Project{
		{ID: "legacy-active", UserID: "owner", Name: "Active", Status: model.ProjectStatusActive},
		{ID: "legacy-archived", UserID: "owner", Name: "Archived", Status: model.ProjectStatusArchived},
	}
	if err := db.Create(&projects).Error; err != nil {
		t.Fatal(err)
	}
	canvases := []model.CanvasProject{
		{ID: "active", UserID: "owner", Title: "Standalone"},
		{ID: "linked-active", UserID: "owner", ProjectID: "legacy-active", Title: "Linked"},
		{ID: "archived", UserID: "owner", ProjectID: "legacy-archived", Title: "Archived"},
		{ID: "other", UserID: "other-owner", Title: "Other"},
	}
	if err := db.Create(&canvases).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"active", "linked-active"} {
		if project, err := s.requireWorkbenchProject("owner", " "+id+" "); err != nil || project.ID != id {
			t.Errorf("owned canvas %q rejected: %v, %v", id, project, err)
		}
	}
	for _, tc := range []struct {
		id     string
		status int
	}{{"", 400}, {"missing", 404}, {"other", 404}, {"legacy-active", 404}, {"archived", 400}} {
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
	for _, id := range []string{"other", "missing", "legacy-active"} {
		_, err := s.WorkbenchTasks("owner", WorkbenchKindImage, id, false, 50)
		var apiErr *AuthError
		if !errors.As(err, &apiErr) || apiErr.Status != 404 {
			t.Fatalf("list project %q: %v", id, err)
		}
	}
}

func TestWorkbenchTasksReadsOwnedCanvasHistoryAfterLinkedProjectArchived(t *testing.T) {
	s, db := newFeatureAvailabilityTestService(t)
	if err := db.AutoMigrate(&model.Project{}, &model.CanvasProject{}, &model.Task{}, &model.BillingOrder{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"imageWorkbenchEnabled":true,"videoWorkbenchEnabled":true}`},
		&model.Project{ID: "archived-project", UserID: "owner", Status: model.ProjectStatusArchived},
		&model.CanvasProject{ID: "canvas", UserID: "owner", ProjectID: "archived-project", Title: "Archived history"},
		&model.CanvasProject{ID: "other-canvas", UserID: "owner", Title: "Other"},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{WorkbenchKindImage, WorkbenchKindVideo} {
		for _, task := range []model.Task{
			{ID: kind + "-history", UserID: "owner", ProjectID: "canvas", Type: "canvas_" + kind, WorkbenchKind: kind, Status: model.TaskStatusSucceeded, InputJSON: `{}`},
			{ID: kind + "-other-canvas", UserID: "owner", ProjectID: "other-canvas", Type: "canvas_" + kind, WorkbenchKind: kind, Status: model.TaskStatusSucceeded, InputJSON: `{}`},
			{ID: kind + "-other-user", UserID: "other-owner", ProjectID: "canvas", Type: "canvas_" + kind, WorkbenchKind: kind, Status: model.TaskStatusSucceeded, InputJSON: `{}`},
		} {
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
		}
		t.Run(kind, func(t *testing.T) {
			tasks, err := s.WorkbenchTasks("owner", kind, " canvas ", false, 50)
			if err != nil {
				t.Fatal(err)
			}
			if len(tasks) != 1 || tasks[0].ID != kind+"-history" || tasks[0].ProjectID != "canvas" {
				t.Fatalf("canvas history = %+v, want only owned %s history", tasks, kind)
			}
		})
	}
}
