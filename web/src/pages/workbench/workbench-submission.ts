import { ApiError } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";

export type WorkbenchSubmissionState = "pending" | "submitting" | "created" | "failed" | "unknown";

/** 丢失回执不等于创建失败；批次字段只是展示标识，不能用来幂等重发。 */
export function workbenchSubmissionFailure(error: unknown, creationAttempted: boolean): "failed" | "unknown" {
    if (!creationAttempted) return "failed";
    if (error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408) return "failed";
    return "unknown";
}

export function resumableWorkbenchIndices(states: WorkbenchSubmissionState[]) {
    if (states.includes("unknown")) return [];
    return states.flatMap((state, index) => (state === "failed" || state === "pending" ? [index] : []));
}

export function reconcileWorkbenchSubmissions<T extends { id: string; states: WorkbenchSubmissionState[]; receipts: Record<number, GenerationTask> }>(batch: T, projectId: string, tasks: GenerationTask[]): T {
    let next = batch;
    for (let index = 0; index < batch.states.length; index += 1) {
        if (batch.states[index] !== "unknown") continue;
        const receipt = tasks.find((task) => task.projectId === projectId && task.clientContext?.batchId === batch.id && (task.clientContext.batchIndex ?? 0) === index);
        if (!receipt) continue;
        if (next === batch) next = { ...batch, states: [...batch.states], receipts: { ...batch.receipts } };
        next.states[index] = "created";
        next.receipts[index] = receipt;
    }
    return next;
}
