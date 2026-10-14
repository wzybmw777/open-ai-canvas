import { ApiError, http } from "./request";
import { getRemoteAsset, upsertRemoteAsset } from "./user-data";
import { getResourceBlob, resolveResourceUrl, resourceStorageKey, uploadResourceFile, type RemoteResource } from "./resources";
import type { GenerationTask } from "./task-center";
import type { ImageAsset } from "@/stores/use-asset-store";
import { isImageCleanupTask } from "@/lib/image-cleanup";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ImageCleanupAvailability = { available: boolean; maxBytes: number; maxPixels: number; maxDimension: number };
export type ImageCleanupInput = { resourceId: string; maskResourceId?: string };
export type ImageCleanupResult = { resourceId: string; width: number; height: number; bytes: number; mimeType: string };

export function imageCleanupStatus(signal?: AbortSignal) {
    return http.get<ImageCleanupAvailability>("/workbench/image-cleanup", { signal });
}

export function imageCleanupInput(task?: GenerationTask): ImageCleanupInput | null {
    try {
        const input = JSON.parse(task?.inputJson || "{}");
        return isImageCleanupTask(task) && typeof input.resourceId === "string" ? input : null;
    } catch { return null; }
}

export function imageCleanupResult(task?: GenerationTask): ImageCleanupResult | null {
    if (task?.status !== "succeeded" || !isImageCleanupTask(task)) return null;
    try {
        const image = JSON.parse(task.resultJson || "{}").images?.[0];
        return typeof image?.resourceId === "string" && image.width > 0 && image.height > 0 ? image : null;
    } catch { return null; }
}

export async function submitImageCleanup(resourceId: string, config: AiConfig, maskDataUrl?: string) {
    const logicalModelId = logicalModelIDForConfig(config);
    const channel = resolveModelChannel(config, config.model);
    if (!logicalModelId && channel.scope !== "system") throw new Error("请选择平台已有的图片编辑模型");
    let maskResourceId: string | undefined;
    if (maskDataUrl) {
        const response = await fetch(maskDataUrl);
        if (!response.ok) throw new Error("读取水印遮罩失败");
        maskResourceId = (await uploadResourceFile(await response.blob(), "image", { fileName: "watermark-mask.png" })).id;
    }
    const task = await http.post<GenerationTask>("/workbench/image-cleanup/tasks", { resourceId, maskResourceId,
        model: modelOptionName(config.model), ...(logicalModelId ? { logicalModelId } : { channelId: channel.id }),
        parameters: { size: config.size, quality: config.quality, imageResolution: config.imageResolution } });
    window.dispatchEvent(new CustomEvent("wallet:updated"));
    return task;
}

export async function readImageCleanupSource(resourceId: string) {
    const blob = await getResourceBlob(resourceStorageKey(resourceId));
    if (!blob) throw new Error("原图资源不存在");
    return blob;
}

export async function uploadImageCleanupSource(file: File, limits: ImageCleanupAvailability): Promise<{ resource: RemoteResource; blob: Blob }> {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片");
    if (!file.size || file.size > limits.maxBytes) throw new Error("图片文件须小于等于 10MB");
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    try {
        if (width > limits.maxDimension || height > limits.maxDimension || width * height > limits.maxPixels) throw new Error("图片最长边须不超过 4096 像素，总像素须不超过 1200 万");
        // Decode EXIF orientation once so browser strokes and server pixels share coordinates.
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法解码图片");
        context.drawImage(bitmap, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片转换失败")), "image/png"));
        if (blob.size > limits.maxBytes) throw new Error("图片解码后超过 10MB，请缩小图片后重试");
        const resource = await uploadResourceFile(blob, "image", { width, height, fileName: "watermark-source.png" });
        return { resource, blob };
    } finally { bitmap.close(); }
}

export async function saveImageCleanupAsset(task: GenerationTask) {
    const result = imageCleanupResult(task);
    if (!result) throw new Error("处理结果尚未保存完成");
    // Repeated saves reuse a stable asset ID and preserve existing user edits.
    const id = `watermark_${task.id}`;
    try { return (await getRemoteAsset(id)).asset; }
    catch (error) {
        if (!(error instanceof ApiError) || error.code !== 404) throw error;
    }
    const url = resolveResourceUrl(resourceStorageKey(result.resourceId));
    const now = new Date().toISOString();
    const asset: ImageAsset = { id, kind: "image", title: "去水印结果", coverUrl: url, tags: [], source: "image-watermark-removal", createdAt: now, updatedAt: now,
        data: { dataUrl: url, storageKey: resourceStorageKey(result.resourceId), width: result.width, height: result.height, bytes: result.bytes, mimeType: result.mimeType }, metadata: { taskId: task.id } };
    await upsertRemoteAsset(asset);
    return asset;
}
