import type { TheatreEpisode } from "@/services/api/theatre";

export type TheatreEpisodeDraft = { key: string; title: string; resourceId?: string; file?: File };

export function episodeDraftsFromWorks(episodes: TheatreEpisode[]): TheatreEpisodeDraft[] {
    return episodes.map((episode) => ({ key: episode.id, title: episode.title, resourceId: episode.resourceId }));
}

export function episodeDraftsFromFiles(files: File[]): TheatreEpisodeDraft[] {
    const order = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    return [...files]
        .sort((a, b) => order.compare(a.name, b.name))
        .map((file) => ({
            key: crypto.randomUUID(),
            title: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
            file,
        }));
}

export function isTheatreVideoFile(file: File) {
    return file.size > 0 && (file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name));
}

export function moveEpisode(drafts: TheatreEpisodeDraft[], index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (index < 0 || index >= drafts.length || destination < 0 || destination >= drafts.length) return drafts;
    const result = [...drafts];
    [result[index], result[destination]] = [result[destination], result[index]];
    return result;
}
