package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentPiModelPersistsParallelToolCallsBeforeResults(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	req := agentTestRequest()
	req.PermissionMode = "auto"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = run.ID
	if err := s.repo.MutateCloudAgent("user", run.ID, stored.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}

	calls := make([]cloudAgentCall, 3)
	for index := range calls {
		calls[index].ID = "call-" + string(rune('1'+index))
		calls[index].Function.Name = "canvas_get_state"
		calls[index].Function.Arguments = "{}"
	}
	if err := s.finishCloudAgentPiModelStep("user", run.ID, run.ID, "", "", calls); err != nil {
		t.Fatal(err)
	}
	stored, err = s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err = cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	last := state.Canonical.Messages[len(state.Canonical.Messages)-1]
	if stringField(last, "role") != "assistant" {
		t.Fatalf("last message role = %q, want assistant", stringField(last, "role"))
	}
	storedCalls := canonicalAgentToolCalls(last["tool_calls"])
	if len(storedCalls) != len(calls) {
		t.Fatalf("assistant tool calls = %d, want %d", len(storedCalls), len(calls))
	}
	for index, call := range storedCalls {
		if stringField(call, "id") != calls[index].ID {
			t.Fatalf("call %d ID = %q, want %q", index, stringField(call, "id"), calls[index].ID)
		}
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "tool", "tool_call_id": calls[index].ID, "content": `{}`})
	}
	wire := canonicalAgentResponsesBody(&state.Canonical)
	input := interfaceSlice(wire["input"])
	for index := range calls {
		call, _ := input[len(input)-6+index].(map[string]any)
		output, _ := input[len(input)-3+index].(map[string]any)
		if stringField(call, "type") != "function_call" || stringField(output, "type") != "function_call_output" || stringField(call, "call_id") != stringField(output, "call_id") {
			t.Fatalf("call/result %d are not paired: call=%v output=%v", index, call, output)
		}
	}
}
