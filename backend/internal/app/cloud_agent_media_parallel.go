package app

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const cloudAgentMediaConcurrency = 4

// Earlier calls may keep generating while the cursor admits the next independent
// media call. All receipts settle before another model step or non-media tool.
type cloudAgentPendingMedia struct {
	TaskID    string `json:"taskId"`
	CallIndex int    `json:"callIndex"`
}

func validateCloudAgentPendingMedia(state *cloudAgentRuntime) error {
	if len(state.PendingMedia) >= cloudAgentMediaConcurrency {
		return errors.New("Agent runtime media concurrency exceeded")
	}
	seenTasks, seenCalls := map[string]bool{}, map[int]bool{}
	for _, pending := range state.PendingMedia {
		if pending.TaskID == "" || pending.TaskID == state.MediaTaskID || !cloudAgentContainsString(state.TaskIDs, pending.TaskID) || seenTasks[pending.TaskID] || seenCalls[pending.CallIndex] || pending.CallIndex < 0 || pending.CallIndex >= state.CallIndex {
			return errors.New("Agent runtime pending media identity is invalid")
		}
		if _, ok := cloudAgentParallelMediaArgs(state.Calls[pending.CallIndex]); !ok {
			return errors.New("Agent runtime pending media call is invalid")
		}
		seenTasks[pending.TaskID], seenCalls[pending.CallIndex] = true, true
	}
	return nil
}

func cloudAgentParallelMediaArgs(call cloudAgentCall) (cloudAgentMediaArgs, bool) {
	var args cloudAgentMediaArgs
	if call.Function.Name != "generate_media" && call.Function.Name != "image_layer_split" {
		return args, false
	}
	err := json.Unmarshal([]byte(cloudAgentMediaCall(call).Function.Arguments), &args)
	return args, err == nil && args.NodeID != ""
}

func cloudAgentIndependentMediaCall(state *cloudAgentRuntime, call cloudAgentCall) bool {
	args, ok := cloudAgentParallelMediaArgs(call)
	if !ok {
		return false
	}
	indices := make([]int, 0, len(state.PendingMedia)+1)
	for _, pending := range state.PendingMedia {
		indices = append(indices, pending.CallIndex)
	}
	if state.MediaTaskID != "" {
		indices = append(indices, state.CallIndex)
	}
	for _, index := range indices {
		active, valid := cloudAgentParallelMediaArgs(state.Calls[index])
		if !valid || args.NodeID == active.NodeID || args.SourceNodeID == active.NodeID || active.SourceNodeID == args.NodeID || cloudAgentContainsString(args.ReferenceNodeIDs, active.NodeID) || cloudAgentContainsString(active.ReferenceNodeIDs, args.NodeID) {
			return false
		}
	}
	return true
}

func (s *Service) parkCloudAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	next := state.CallIndex + 1
	if len(state.PendingMedia) >= cloudAgentMediaConcurrency-1 || next >= len(state.Calls) || !cloudAgentIndependentMediaCall(state, state.Calls[next]) {
		return nil
	}
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.PendingMedia = append(state.PendingMedia, cloudAgentPendingMedia{TaskID: state.MediaTaskID, CallIndex: state.CallIndex})
		state.MediaTaskID, state.Approval = "", nil
		state.CallIndex++
		return cloudAgentSave(current, state)
	})
}

func (s *Service) collectCloudAgentPendingMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime) (bool, error) {
	for _, pending := range state.PendingMedia {
		task, err := s.repo.TaskForUser(run.UserID, pending.TaskID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
		if err != nil || cloudAgentTaskTerminal(task.Status) {
			return true, s.completeCloudAgentMediaTask(run, state, cloudAgentMediaCall(state.Calls[pending.CallIndex]), pending.TaskID)
		}
	}
	return false, nil
}

func cloudAgentMediaToolResult(runID string, state *cloudAgentRuntime, call cloudAgentCall, taskID string, result any, err error) {
	for index, pending := range state.PendingMedia {
		if pending.TaskID != taskID {
			continue
		}
		// Out-of-order results belong to the earlier call, not the cursor's
		// current approval. Restore that control state before saving.
		cursor, approval := state.CallIndex, state.Approval
		cloudAgentToolResult(runID, state, call, result, err)
		state.CallIndex, state.Approval = cursor, approval
		state.PendingMedia = append(state.PendingMedia[:index], state.PendingMedia[index+1:]...)
		return
	}
	cloudAgentToolResult(runID, state, call, result, err)
	state.MediaTaskID = ""
}

func (s *Service) cloudAgentMediaCompletionError(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, taskID string, err error) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		cloudAgentMediaToolResult(run.ID, state, call, taskID, map[string]any{"phase": "completion", "taskSubmitted": true, "taskId": taskID}, err)
		if current.Status != "cancelled" {
			current.Status = "failed"
		}
		current.FailureMessage = cloudAgentSafeToolError(err)
		current.CleanupPending = true
		state.event(run.ID, "run_failed", map[string]any{"text": current.FailureMessage, "taskId": taskID})
		return cloudAgentSave(current, state)
	})
}
