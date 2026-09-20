package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestTaskLeaseRenewalSurvivesExecutionDeadline(t *testing.T) {
	execution, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if !errors.Is(execution.Err(), context.DeadlineExceeded) {
		t.Fatal("execution deadline must already be expired")
	}
	renewed := make(chan error, 8)
	var calls atomic.Int32
	lost, stop := startTaskLeaseRenewal(time.Millisecond, func(ctx context.Context) error {
		calls.Add(1)
		select {
		case renewed <- ctx.Err():
		default:
		}
		return ctx.Err()
	}, cancel)
	defer stop()
	for range 2 {
		select {
		case err := <-renewed:
			if err != nil {
				t.Fatalf("generation deadline cancelled lease renewal: %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("lease did not renew during terminal cleanup")
		}
	}
	stop()
	select {
	case err := <-lost:
		t.Fatalf("execution timeout was reported as lost ownership: %v", err)
	default:
	}
	before := calls.Load()
	time.Sleep(5 * time.Millisecond)
	if calls.Load() != before {
		t.Fatal("renewal continued after worker cleanup")
	}
}

func TestTaskLeaseRenewalFailureCancelsExecution(t *testing.T) {
	execution, cancel := context.WithCancel(context.Background())
	defer cancel()
	failure := errors.New("lease owner changed")
	lost, stop := startTaskLeaseRenewal(time.Millisecond, func(context.Context) error { return failure }, cancel)
	defer stop()
	select {
	case <-execution.Done():
	case <-time.After(time.Second):
		t.Fatal("lost ownership did not cancel provider execution")
	}
	if err := <-lost; !errors.Is(err, failure) {
		t.Fatalf("lost ownership error = %v", err)
	}
}

func TestTaskLeaseRenewalStopDoesNotCancelExecution(t *testing.T) {
	execution, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	lost, stop := startTaskLeaseRenewal(time.Millisecond, func(ctx context.Context) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}, cancel)
	defer stop()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("renewal did not start")
	}
	stop()
	if execution.Err() != nil {
		t.Fatalf("normal worker cleanup cancelled execution: %v", execution.Err())
	}
	select {
	case err := <-lost:
		t.Fatalf("normal cleanup was reported as lost ownership: %v", err)
	default:
	}
}

func TestWorkerTextTimeoutPersistsFailureWithoutAutomaticReplay(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	fixture, db, _, _ := creationTestService(t)
	s := New(fixture.repo, fixture.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	port := &taskRouteExecutionPortStub{
		processResults: map[string]taskRouteExecutionStubResult{"": {err: context.DeadlineExceeded}},
	}
	s.taskRouteExecutor = &taskRouteExecutor{port: port}
	task := model.Task{
		ID: "timeout-task", UserID: "user", Type: "canvas_text", Status: model.TaskStatusQueued,
		InputJSON: `{}`, TextDraft: "partial output", ProviderRequestID: "response-existing",
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.ProcessNextTask(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("worker timeout = %v", err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.CompletedAt == nil || stored.Attempts != 1 || stored.TextDraft != "partial output" {
		t.Fatalf("timeout was not persisted as a terminal failure: %+v", stored)
	}
	if err := s.ProcessNextTask(); err != nil {
		t.Fatalf("second dispatch: %v", err)
	}
	if len(port.processCalls) != 1 {
		t.Fatalf("worker automatically replayed interrupted generation: %v", port.processCalls)
	}
}
