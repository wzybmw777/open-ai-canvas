import { apiBaseURL, compactApiParams, http } from "@/services/api/request";

export type TheatreWorkKind = "video" | "short_drama";
export type TheatreWork = {
    id: string;
    userId: string;
    resourceId: string;
    coverResourceId: string;
    kind: TheatreWorkKind;
    isComplete: boolean;
    episodeCount: number;
    title: string;
    description: string;
    authorName: string;
    size: number;
    durationMs: number;
    createdAt: string;
    updatedAt: string;
};

export type TheatreEpisodeInput = { resourceId: string; title: string };
export type TheatreEpisode = TheatreEpisodeInput & { id: string; workId: string; number: number; size: number; durationMs: number };
export type TheatreWorkDetail = { work: TheatreWork; episodes: TheatreEpisode[] };
export type TheatreWorkPage = { works: TheatreWork[]; total: number; page: number; pageSize: number };
export type TheatreWorkMetadata = { title: string; description: string; coverResourceId?: string; kind?: TheatreWorkKind; isComplete?: boolean; episodes?: TheatreEpisodeInput[]; expectedUpdatedAt?: string };

export function listTheatreWorks(params: { q?: string; mine?: boolean; kind?: TheatreWorkKind | ""; page: number; pageSize: number }, signal?: AbortSignal) {
    return http.get<TheatreWorkPage>("/theatre/works", { params: compactApiParams({ ...params, mine: params.mine ? "true" : undefined }), signal });
}

export function createTheatreWork(input: TheatreWorkMetadata & { resourceId?: string }) {
    return http.post<{ work: Pick<TheatreWork, "id" | "title" | "description" | "resourceId" | "coverResourceId" | "kind" | "isComplete"> }>("/theatre/works", input);
}

export function getTheatreWork(id: string, signal?: AbortSignal) {
    return http.get<TheatreWorkDetail>(`/theatre/works/${encodeURIComponent(id)}`, { signal });
}

export function theatreEpisodeVideoUrl(workId: string, episodeId: string) {
    return `${String(apiBaseURL).replace(/\/+$/, "")}/theatre/works/${encodeURIComponent(workId)}/episodes/${encodeURIComponent(episodeId)}/video`;
}

export function updateTheatreWork(id: string, input: TheatreWorkMetadata) {
    return http.patch<{ id: string }>(`/theatre/works/${encodeURIComponent(id)}`, input);
}

export function deleteTheatreWork(id: string) {
    return http.delete<{ id: string }>(`/theatre/works/${encodeURIComponent(id)}`);
}

export function theatreVideoUrl(id: string) {
    return `${String(apiBaseURL).replace(/\/+$/, "")}/theatre/works/${encodeURIComponent(id)}/video`;
}

export function theatreCoverUrl(id: string, revision?: string) {
    const url = `${String(apiBaseURL).replace(/\/+$/, "")}/theatre/works/${encodeURIComponent(id)}/cover`;
    return revision ? `${url}?v=${encodeURIComponent(revision)}` : url;
}
