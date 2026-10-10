import { http } from "./request";

export interface ChannelSyncConfig {
    enabled: boolean;
    script: "authorized-models" | "model-plaza";
    sourceUrl: string;
    groupId: number;
    syncPrices: boolean;
    importNew: boolean;
}
export interface ChannelSyncRun {
    id: string;
    channelId: string;
    trigger: "manual" | "scheduled";
    status: "running" | "success" | "failed";
    summary: string;
    startedAt: string;
    finishedAt: string | null;
}
export interface ChannelSyncView {
    channelId: string;
    channelName: string;
    configured: boolean;
    job: ChannelSyncConfig & { nextRunAt: string | null; lastRunId: string };
    lastRun: ChannelSyncRun | null;
}
export function listChannelSyncJobs(signal?: AbortSignal) {
    return http.get<{ jobs: ChannelSyncView[]; timezone: string; schedule: string }>("/admin/channel-sync", { signal });
}
export function saveChannelSyncJob(id: string, input: ChannelSyncConfig) {
    return http.put<{ job: ChannelSyncView["job"] }>(`/admin/channel-sync/${encodeURIComponent(id)}`, input);
}
export function runChannelSyncJob(id: string) {
    return http.post<{ run: ChannelSyncRun }>(`/admin/channel-sync/${encodeURIComponent(id)}/run`);
}
export function listChannelSyncRuns(id: string, signal?: AbortSignal) {
    return http.get<{ runs: ChannelSyncRun[] }>(`/admin/channel-sync/${encodeURIComponent(id)}/runs`, { signal });
}
