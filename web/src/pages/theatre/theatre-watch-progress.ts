import { localForageStorageForScope } from "@/lib/localforage-storage";

export type TheatreWatchProgress = { episodeId: string; seconds: number };

export async function readTheatreWatchProgress(userId: string, workId: string): Promise<TheatreWatchProgress | null> {
    const value = await localForageStorageForScope(userId).getItem(`theatre-watch:${workId}`);
    if (!value) return null;
    try {
        const progress: unknown = JSON.parse(value);
        if (typeof progress !== "object" || progress === null) return null;
        const record = progress as Record<string, unknown>;
        return typeof record.episodeId === "string" && record.episodeId.length > 0 && typeof record.seconds === "number" && Number.isFinite(record.seconds) && record.seconds >= 0 ? { episodeId: record.episodeId, seconds: record.seconds } : null;
    } catch {
        return null;
    }
}

export async function saveTheatreWatchProgress(userId: string, workId: string, progress: TheatreWatchProgress) {
    await localForageStorageForScope(userId).setItem(`theatre-watch:${workId}`, JSON.stringify(progress));
}
