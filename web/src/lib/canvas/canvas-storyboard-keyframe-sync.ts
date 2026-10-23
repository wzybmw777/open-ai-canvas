import { createStoryboardKeyframe, normalizeStoryboardKeyframes } from "@/lib/canvas/canvas-storyboard-keyframes";
import type { CanvasNodeData, StoryboardKeyframePromptDescription, StoryboardRow } from "@/types/canvas";

export function updateStoryboardKeyframe(row: StoryboardRow, keyframeId: string, patch: Partial<StoryboardKeyframePromptDescription>): StoryboardRow {
    const keyframes = normalizeStoryboardKeyframes(row);
    const current = keyframes.find((item) => item.id === keyframeId);
    if (!current) return row;
    const promptChanged = patch.prompt !== undefined && patch.prompt !== current.prompt;
    const next = keyframes.map((item) => item.id === keyframeId
        ? { ...item, ...patch, promptTemplateVariables: promptChanged ? undefined : patch.promptTemplateVariables === undefined ? item.promptTemplateVariables : patch.promptTemplateVariables }
        : item);
    return { ...row, keyframePromptDescriptions: next };
}

export function appendStoryboardKeyframe(row: StoryboardRow, patch: Partial<StoryboardKeyframePromptDescription> = {}, afterKeyframeId?: string): StoryboardRow {
    const keyframes = normalizeStoryboardKeyframes(row);
    const index = afterKeyframeId ? keyframes.findIndex((item) => item.id === afterKeyframeId) + 1 : keyframes.length;
    const insertAt = index > 0 ? index : keyframes.length;
    const nextLength = keyframes.length + 1;
    const defaultRatio = nextLength === 1 ? 0 : Math.min(1, insertAt / (nextLength - 1));
    const item = createStoryboardKeyframe(insertAt, {
        prompt: (patch.prompt || row.imageGenerationPrompt || row.plotDescription || "").trim(),
        ...patch,
        timeRatio: patch.timeRatio ?? defaultRatio,
    });
    const next = [...keyframes];
    next.splice(insertAt, 0, item);
    return { ...row, keyframePromptDescriptions: next.map((candidate, order) => ({ ...candidate, order })) };
}

export function removeStoryboardKeyframe(row: StoryboardRow, keyframeId: string): StoryboardRow {
    const next = normalizeStoryboardKeyframes(row).filter((item) => item.id !== keyframeId).map((item, order) => ({ ...item, order }));
    return { ...row, keyframePromptDescriptions: next };
}

export function reorderStoryboardKeyframes(row: StoryboardRow, orderedIds: string[]): StoryboardRow {
    const keyframes = normalizeStoryboardKeyframes(row);
    const byId = new Map(keyframes.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const ordered: StoryboardKeyframePromptDescription[] = [];
    for (const id of [...orderedIds, ...keyframes.map((item) => item.id)]) {
        const item = byId.get(id);
        if (!item || seen.has(id)) continue;
        seen.add(id);
        ordered.push(item);
    }
    const lastIndex = Math.max(0, ordered.length - 1);
    const next = ordered.map((item, order) => ({ ...item, order, timeRatio: lastIndex === 0 ? 0 : order / lastIndex }));
    return { ...row, keyframePromptDescriptions: next };
}

export function markStoryboardVideoStale(nodes: CanvasNodeData[], row: StoryboardRow) {
    if (!row.videoNodeId) return nodes;
    return nodes.map((node) => node.id === row.videoNodeId && node.type === "video" ? { ...node, metadata: { ...node.metadata, needsRegeneration: true } } : node);
}
