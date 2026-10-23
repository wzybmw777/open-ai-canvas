import type {
    StoryboardAssetBinding,
    StoryboardKeyframePromptDescription,
    StoryboardRow,
} from "@/types/canvas";

function createKeyframeId() {
    return `keyframe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampRatio(value: unknown, fallback: number) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(1, Math.max(0, number));
}

function normalizeBindings(value: unknown): StoryboardAssetBinding[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const binding = candidate as Partial<StoryboardAssetBinding>;
        if (!binding.nodeId || typeof binding.nodeId !== "string") return [];
        return [{
            nodeId: binding.nodeId,
            role: binding.role || "prop",
            priority: Number.isFinite(Number(binding.priority)) ? Number(binding.priority) : 0,
        }];
    });
}

export function createStoryboardKeyframe(order: number, patch: Partial<StoryboardKeyframePromptDescription> = {}): StoryboardKeyframePromptDescription {
    const normalizedOrder = Number.isFinite(Number(patch.order)) ? Number(patch.order) : order;
    return {
        id: patch.id || createKeyframeId(),
        order: Number.isFinite(normalizedOrder) ? Math.max(0, Math.trunc(normalizedOrder)) : 0,
        timeRatio: clampRatio(patch.timeRatio, 0),
        prompt: typeof patch.prompt === "string" ? patch.prompt : "",
        assetBindings: normalizeBindings(patch.assetBindings),
        imageNodeId: patch.imageNodeId,
        status: patch.status || "idle",
        errorDetails: patch.errorDetails,
        promptTemplateVariables: patch.promptTemplateVariables,
    };
}

export function normalizeStoryboardKeyframes(row: Pick<StoryboardRow, "keyframePromptDescriptions" | "imageGenerationPrompt" | "plotDescription">): StoryboardKeyframePromptDescription[] {
    const source = row.keyframePromptDescriptions;
    if (!Array.isArray(source)) return [];
    const fallbackPrompt = (row.imageGenerationPrompt || row.plotDescription || "").trim();
    const lastIndex = Math.max(0, source.length - 1);
    return source.map((candidate, index) => {
        const value = candidate && typeof candidate === "object" ? candidate : {};
        const raw = value as Partial<StoryboardKeyframePromptDescription>;
        const defaultRatio = lastIndex === 0 ? 0 : index / lastIndex;
        const item = createStoryboardKeyframe(index, {
            ...raw,
            id: raw.id || undefined,
            order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
            prompt: typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt : fallbackPrompt,
            timeRatio: clampRatio(raw.timeRatio, defaultRatio),
            assetBindings: normalizeBindings(raw.assetBindings),
        });
        return item;
    });
}

export function sortStoryboardKeyframes(items: StoryboardKeyframePromptDescription[]) {
    return items
        .map((item, index) => ({ item, index }))
        .sort((left, right) => left.item.timeRatio - right.item.timeRatio || left.item.order - right.item.order || left.index - right.index)
        .map(({ item }) => item);
}

export function effectiveStoryboardKeyframeAssets(row: Pick<StoryboardRow, "assetBindings">, item: Pick<StoryboardKeyframePromptDescription, "assetBindings">): StoryboardAssetBinding[] {
    const merged = new Map<string, StoryboardAssetBinding>();
    for (const binding of row.assetBindings || []) merged.set(binding.nodeId, binding);
    for (const binding of item.assetBindings || []) merged.set(binding.nodeId, binding);
    return Array.from(merged.values());
}

export function remapStoryboardKeyframeReferences(row: StoryboardRow, idMap: ReadonlyMap<string, string>): StoryboardRow {
    const keyframes = normalizeStoryboardKeyframes(row).map((item, index) => ({
        ...item,
        id: createKeyframeId(),
        order: index,
        imageNodeId: item.imageNodeId ? idMap.get(item.imageNodeId) : undefined,
        assetBindings: item.assetBindings.map((binding) => ({ ...binding, nodeId: idMap.get(binding.nodeId) || binding.nodeId })),
    }));
    return {
        ...row,
        keyframeGroupNodeId: row.keyframeGroupNodeId ? idMap.get(row.keyframeGroupNodeId) : undefined,
        keyframePromptDescriptions: keyframes,
        imageNodeId: row.imageNodeId ? idMap.get(row.imageNodeId) : undefined,
        videoNodeId: row.videoNodeId ? idMap.get(row.videoNodeId) : undefined,
        assetBindings: (row.assetBindings || []).map((binding) => ({ ...binding, nodeId: idMap.get(binding.nodeId) || binding.nodeId })),
    };
}
