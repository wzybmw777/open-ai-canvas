import { getNodeListLabel } from "@/lib/canvas/node-registry";
import type { AppLocale } from "@/lib/i18n";
import { producedModelLabel, producedModelSearchTerms } from "@/lib/canvas/produced-model";
import type { AiConfig } from "@/stores/use-config-store";
import { canvasNodeCreatedAt, canvasNodeUpdatedAt } from "@/lib/canvas/canvas-node-timestamps";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const searchTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});

export function searchCanvasNodes(nodes: CanvasNodeData[], query: string, limit = 80, config?: AiConfig) {
    const keyword = query.trim().toLocaleLowerCase();
    return nodes
        .filter((node) => !keyword || canvasNodeSearchTerms(node, config).some((value) => value.toLocaleLowerCase().includes(keyword)))
        .toSorted((left, right) => timestampValue(canvasNodeUpdatedAt(right)) - timestampValue(canvasNodeUpdatedAt(left)))
        .slice(0, keyword ? limit : Math.min(limit, 40));
}

export function canvasNodeSearchContext(node: CanvasNodeData, locale: AppLocale = "zh-CN") {
    const location = [node.metadata?.chapterTitle, typeof node.metadata?.shotIndex === "number" ? locale === "en-US" ? `Shot ${node.metadata.shotIndex + 1}` : `镜头 ${node.metadata.shotIndex + 1}` : ""].filter(Boolean).join(" · ");
    const textContent = node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Markdown || node.type === CanvasNodeType.Script || node.type === CanvasNodeType.Skill
        ? node.metadata?.content
        : undefined;
    return location || node.metadata?.prompt || node.metadata?.composerContent || node.metadata?.workflowDescription || textContent || getNodeListLabel(node.type, locale);
}

export function canvasNodeMaterialSummary(node: CanvasNodeData, config?: AiConfig, locale: AppLocale = "zh-CN") {
    const details = [getNodeListLabel(node.type, locale)];
    const width = node.metadata?.naturalWidth;
    const height = node.metadata?.naturalHeight;
    if (width && height) details.push(`${width}×${height}`);
    if (node.metadata?.durationMs) details.push(formatDuration(node.metadata.durationMs, locale));
    if (node.metadata?.bytes) details.push(formatBytes(node.metadata.bytes));
    const producedModel = node.metadata?.producedModel;
    if (producedModel) details.splice(1, 0, config ? producedModelLabel(config, producedModel) : producedModel);
    return details.slice(0, 3).join(" · ");
}

export function canvasNodeSearchTimes(node: CanvasNodeData, locale: AppLocale = "zh-CN") {
    const createdAt = canvasNodeCreatedAt(node);
    const updatedAt = canvasNodeUpdatedAt(node);
    return {
        createdAt,
        updatedAt,
        createdLabel: createdAt ? locale === "en-US" ? new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(createdAt)) : searchTimeFormatter.format(new Date(createdAt)) : locale === "en-US" ? "Not recorded" : "未记录",
        updatedLabel: updatedAt ? locale === "en-US" ? new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(updatedAt)) : searchTimeFormatter.format(new Date(updatedAt)) : locale === "en-US" ? "Not recorded" : "未记录",
    };
}

function canvasNodeSearchTerms(node: CanvasNodeData, config?: AiConfig) {
    return [
        node.title,
        node.type,
        getNodeListLabel(node.type),
        getNodeListLabel(node.type, "en-US"),
        node.metadata?.prompt,
        node.metadata?.composerContent,
        node.metadata?.model,
        ...producedModelSearchTerms(node.metadata, config),
        node.metadata?.chapterTitle,
        node.metadata?.workflowTitle,
        node.metadata?.workflowDescription,
        typeof node.metadata?.shotIndex === "number" ? `镜头 ${node.metadata.shotIndex + 1}` : "",
        ...(node.metadata?.assetTags || []),
    ].filter((value): value is string => typeof value === "string" && Boolean(value));
}

function timestampValue(value?: string) {
    const timestamp = value ? Date.parse(value) : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDuration(durationMs: number, locale: AppLocale) {
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    if (locale === "en-US") return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    if (seconds < 60) return `${seconds}秒`;
    return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
