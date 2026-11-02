import { expect, test } from "bun:test";
import { ApiError } from "../src/services/api/request";
import type { GenerationTask } from "../src/services/api/task-center";
import { reconcileWorkbenchSubmissions, resumableWorkbenchIndices, workbenchSubmissionFailure, type WorkbenchSubmissionState } from "../src/pages/workbench/workbench-submission";

test("a lost creation receipt prevents resubmission until the project task list confirms it", () => {
    const batch = { id: "batch-a", states: [workbenchSubmissionFailure(new ApiError("timeout", { status: 504 }), true), "pending"] as WorkbenchSubmissionState[], receipts: {} };
    expect(resumableWorkbenchIndices(batch.states)).toEqual([]);
    const task = { id: "created", projectId: "project-a", clientContext: { batchId: "batch-a" } } as GenerationTask;
    expect(reconcileWorkbenchSubmissions(batch, "project-b", [task])).toBe(batch);
    expect(reconcileWorkbenchSubmissions(batch, "project-a", [{ ...task, clientContext: { batchId: "different" } }])).toBe(batch);
    const confirmed = reconcileWorkbenchSubmissions(batch, "project-a", [task]);
    expect(confirmed.receipts[0]?.id).toBe("created");
    expect(resumableWorkbenchIndices(confirmed.states)).toEqual([1]);
    expect(batch.states).toEqual(["unknown", "pending"]);
});

test("explicit rejection can be retried while transport failures and missing receipts cannot", () => {
    expect(workbenchSubmissionFailure(new ApiError("limit", { status: 429 }), true)).toBe("failed");
    expect(workbenchSubmissionFailure(new Error("project unavailable"), false)).toBe("failed");
    for (const error of [new Error("missing id"), new ApiError("disconnected"), new ApiError("timeout", { status: 408 }), new ApiError("server error", { status: 500 })]) {
        expect(workbenchSubmissionFailure(error, true)).toBe("unknown");
    }
});
