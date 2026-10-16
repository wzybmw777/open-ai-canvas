package app

import (
	"context"
	"time"

	"github.com/google/uuid"
	"yingce/backend/internal/model"
)

type providerSubmissionKeyContext struct{}

func withProviderSubmissionKey(ctx context.Context, attempt *model.RouteAttempt) context.Context {
	if attempt == nil {
		return ctx
	}
	// Stable for this persisted attempt across worker/process recovery; an
	// explicitly new user retry or a safely rejected route gets a new attempt.
	key := uuid.NewSHA1(uuid.NameSpaceOID, []byte(attempt.TaskID+":"+attempt.ID)).String()
	return context.WithValue(ctx, providerSubmissionKeyContext{}, key)
}

func (s *Service) createDirectTaskAttempt(task *model.Task) (*model.RouteAttempt, error) {
	// Positive runs use persisted dispatch records before every provider call.
	// Claim attempts alone do not prove submission: a claim can time out before
	// execution starts. Only legacy tasks lack that guarantee.
	if task.RouteRun <= 0 && task.Attempts > 1 && task.ProviderRequestID == "" {
		return nil, routeDispatchUncertainError{"旧任务已尝试执行但缺少提交记录，为避免重复扣费已停止自动重发"}
	}
	id, err := s.repo.NextPrefixedID("ATTEMPT")
	if err != nil {
		return nil, err
	}
	attempt := &model.RouteAttempt{ID: id, TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: 1, ChannelModelID: task.ChannelModelID, Status: "selected", DispatchState: "not_sent", StartedAt: time.Now()}
	if task.ProviderRequestID != "" {
		attempt.ProviderRequestID, attempt.DispatchState = task.ProviderRequestID, "accepted"
	}
	if err := s.repo.CreateRouteAttempt(attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}
