import { ApiError, http } from "@/services/api/request";
import { getResourceBlob, resolveResourceUrl, resourceStorageKey, uploadResourceFile, type RemoteResource } from "@/services/api/resources";
import { getRemoteAsset, upsertRemoteAsset } from "@/services/api/user-data";
import type { GenerationTask } from "@/services/api/task-center";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { VideoAsset } from "@/stores/use-asset-store";
import { isVideoCleanupTask } from "@/lib/video-cleanup";

const MAX_VIDEO_BYTES = 100 << 20;

export type VideoCleanupAvailability = { available: boolean; maxBytes: number; minSeconds: number; maxSeconds: number; message?: string };
export function videoCleanupStatus(signal?: AbortSignal) { return http.get<VideoCleanupAvailability>("/workbench/video-cleanup", { signal }); }

export async function uploadVideoWatermarkSource(file: File): Promise<{ resource: RemoteResource; blob: Blob; width: number; height: number; durationMs: number }> {
    if (!["video/mp4", "video/quicktime"].includes(file.type)) throw new Error("请选择 MP4 或 MOV 视频");
    if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error("视频文件须小于等于 100MB");
    const metadata = await readVideoMetadata(file);
    if (metadata.durationMs < 3000 || metadata.durationMs > 15000) throw new Error("当前版本支持 3–15 秒视频，请先裁剪后上传");
    const short = Math.min(metadata.width, metadata.height), long = Math.max(metadata.width, metadata.height);
    if (short < 360 || long > 4096 || long / short > 2.5) throw new Error("视频短边须至少 360 像素，长边不超过 4096，比例在 1:2.5 至 2.5:1 之间");
    const resource = await uploadResourceFile(file, "video", { ...metadata, fileName: file.name });
    return { resource, blob: file, ...metadata };
}

export async function readVideoWatermarkSource(resourceId: string) {
    const blob = await getResourceBlob(resourceStorageKey(resourceId));
    if (!blob) throw new Error("原视频资源不存在");
    return blob;
}

export async function submitVideoWatermark(resourceId: string, config: AiConfig, prompt: string) {
    const logicalModelId = logicalModelIDForConfig(config), channel = resolveModelChannel(config, config.model);
    if (!logicalModelId && channel.scope !== "system") throw new Error("请选择平台已有的视频编辑模型");
    const task = await http.post<GenerationTask>("/workbench/video-cleanup/tasks", { resourceId, model: modelOptionName(config.model), ...(logicalModelId ? { logicalModelId } : { channelId: channel.id }), prompt: prompt.trim(), resolution: config.vquality });
    window.dispatchEvent(new CustomEvent("wallet:updated"));
    return task;
}

export function videoWatermarkInput(task?: GenerationTask) {
    try {
        const input = JSON.parse(task?.inputJson || "{}");
        return isVideoCleanupTask(task) && typeof input.resourceId === "string" ? input : null;
    } catch { return null; }
}

export function videoWatermarkResult(task?: GenerationTask) {
    if (task?.status !== "succeeded" || !isVideoCleanupTask(task)) return null;
    try {
        const video = JSON.parse(task.resultJson || "{}").video;
        return typeof video?.resourceId === "string" ? video : null;
    } catch { return null; }
}

export async function saveVideoWatermarkAsset(task: GenerationTask) {
    const result = videoWatermarkResult(task);
    if (!result) throw new Error("视频结果尚未保存完成");
    const id = `video-watermark_${task.id}`;
    try { return (await getRemoteAsset(id)).asset; }
    catch (error) { if (!(error instanceof ApiError) || error.code !== 404) throw error; }
    const url = resolveResourceUrl(resourceStorageKey(result.resourceId));
    const now = new Date().toISOString();
    const asset: VideoAsset = { id, kind: "video", title: "去水印视频", coverUrl: "", tags: [], source: "video-watermark-removal", createdAt: now, updatedAt: now, data: { url, storageKey: resourceStorageKey(result.resourceId), width: result.width || 0, height: result.height || 0, durationMs: result.durationMs, bytes: result.bytes || 0, mimeType: result.mimeType || "video/mp4" }, metadata: { taskId: task.id } };
    await upsertRemoteAsset(asset);
    return asset;
}

export function readVideoMetadata(blob: Blob) {
    const url = URL.createObjectURL(blob);
    return new Promise<{ width: number; height: number; durationMs: number }>((resolve, reject) => {
        const video = document.createElement("video");
        const clear = () => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); };
        const timer = setTimeout(() => { clear(); reject(new Error("视频读取超时")); }, 15000);
        video.preload = "metadata";
        video.onloadedmetadata = () => {
            const meta = { width: video.videoWidth, height: video.videoHeight, durationMs: Math.round(video.duration * 1000) };
            clear();
            if (!meta.width || !meta.height || !Number.isFinite(meta.durationMs) || meta.durationMs <= 0) reject(new Error("视频缺少有效的尺寸或时长"));
            else resolve(meta);
        };
        video.onerror = () => { clear(); reject(new Error("视频无法读取，请使用浏览器可播放的 MP4 或 MOV 文件")); };
        video.src = url;
    });
}
