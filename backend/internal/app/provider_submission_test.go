package app

import (
	"context"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestDirectTaskReclaimedBeforeDispatch(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	task, err := s.CreateTask("user", creationTextRequest())
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil || stored.RouteRun != 1 || stored.LogicalModelID != "" {
		t.Fatalf("direct task not initialized with dispatch tracking: %+v %v", stored, err)
	}
	first, err := s.repo.ClaimNextTask("first-worker", time.Minute)
	if err != nil || first == nil {
		t.Fatalf("first claim: %+v %v", first, err)
	}
	// The first worker never entered execution, as when a claim response times out.
	if err := db.Model(task).Update("lease_expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	reclaimed, err := s.repo.ClaimNextTask("second-worker", time.Minute)
	if err != nil || reclaimed == nil || reclaimed.Attempts != 2 {
		t.Fatalf("reclaim: %+v %v", reclaimed, err)
	}
	attempt, err := s.beginTaskRouteAttempt(reclaimed)
	if err != nil || attempt == nil || attempt.DispatchState != "not_sent" {
		t.Fatalf("unsubmitted task blocked: %+v %v", attempt, err)
	}
	recovered, err := s.beginTaskRouteAttempt(reclaimed)
	if err != nil || recovered.ID != attempt.ID {
		t.Fatalf("selected attempt not reused: %+v %v", recovered, err)
	}
	if err := s.markRouteAttemptDispatching(attempt); err != nil {
		t.Fatal(err)
	}
	if _, err := s.beginTaskRouteAttempt(reclaimed); !isRouteDispatchUncertain(err) {
		t.Fatalf("ambiguous submission allowed: %v", err)
	}
	reclaimed.ProviderRequestID = "existing-upstream-task"
	recovered, err = s.beginTaskRouteAttempt(reclaimed)
	if err != nil || recovered.ID != attempt.ID || recovered.DispatchState != "accepted" {
		t.Fatalf("accepted task not recovered: %+v %v", recovered, err)
	}
	if withProviderSubmissionKey(context.Background(), attempt).Value(providerSubmissionKeyContext{}) != withProviderSubmissionKey(context.Background(), recovered).Value(providerSubmissionKeyContext{}) {
		t.Fatal("recovery changed submission key")
	}
}

func TestDirectTaskLegacyRecoveryAndExplicitRetry(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := &model.Task{ID: newID(), UserID: "user", Type: "canvas_video", Status: model.TaskStatusFailed, Attempts: 2}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.beginTaskRouteAttempt(task); !isRouteDispatchUncertain(err) {
		t.Fatalf("legacy task resubmitted without evidence: %v", err)
	}
	retried, err := s.repo.RetryTaskWithBilling(task.UserID, task, nil, 10)
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := s.repo.ClaimNextTask("retry-worker", time.Minute)
	if err != nil || claimed == nil || claimed.ID != retried.ID || claimed.RouteRun != 1 || claimed.Attempts != 3 {
		t.Fatalf("retry claim: %+v %v", claimed, err)
	}
	attempt, err := s.beginTaskRouteAttempt(claimed)
	if err != nil || attempt == nil || attempt.DispatchState != "not_sent" {
		t.Fatalf("explicit retry blocked by cumulative attempts: %+v %v", attempt, err)
	}
}
