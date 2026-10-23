import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNodeType, type StoryboardRow } from "@/types/canvas";
import {
    createStoryboardKeyframe,
    effectiveStoryboardKeyframeAssets,
    normalizeStoryboardKeyframes,
    remapStoryboardKeyframeReferences,
    sortStoryboardKeyframes,
} from "./canvas-storyboard-keyframes";

function row(patch: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        id: "shot-1",
        shotNumber: 1,
        durationSeconds: 10,
        plotDescription: "一只猫走过房间",
        dialogue: "",
        characters: [],
        narrativeIntent: "",
        viewerPOV: "",
        performanceBlocking: "",
        shotSize: "",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "电影感猫",
        videoMotionPrompt: "",
        mustHave: [],
        optionalDetails: [],
        continuityOut: "",
        negativePrompt: "",
        assetBindings: [{ nodeId: "row-asset", role: "style", priority: 1 }],
        ...patch,
    };
}

test("legacy row 缺少关键帧字段时归一化为空列表，数量由列表长度派生", () => {
    const normalized = normalizeStoryboardKeyframes(row());
    assert.deepEqual(normalized, []);
    assert.equal(normalized.length, 0);
});

test("关键帧创建使用稳定 ID、边界时间和默认提示词", () => {
    const item = createStoryboardKeyframe(2, { prompt: "中间动作", timeRatio: 1.5 });
    assert.match(item.id, /^keyframe-/);
    assert.equal(item.order, 2);
    assert.equal(item.timeRatio, 1);
    assert.equal(item.prompt, "中间动作");
    assert.deepEqual(item.assetBindings, []);
});

test("归一化会补齐 ID、顺序和均匀时间点，并用首帧提示词兜底", () => {
    const normalized = normalizeStoryboardKeyframes(row({
        keyframePromptDescriptions: [
            { prompt: "", assetBindings: [] },
            { prompt: "中间", timeRatio: 0.75, assetBindings: [{ nodeId: "frame-asset", role: "prop", priority: 2 }] },
            { prompt: "结束", assetBindings: [] },
        ],
    }));

    assert.equal(normalized.length, 3);
    assert.equal(normalized[0]?.prompt, "电影感猫");
    assert.deepEqual(normalized.map((item) => item.order), [0, 1, 2]);
    assert.deepEqual(normalized.map((item) => item.timeRatio), [0, 0.75, 1]);
    assert.equal(new Set(normalized.map((item) => item.id)).size, 3);
});

test("时间排序按 timeRatio，重复时间点保持原 order 稳定", () => {
    const items = normalizeStoryboardKeyframes(row({
        keyframePromptDescriptions: [
            { id: "a", order: 5, timeRatio: 0.5, prompt: "A", assetBindings: [] },
            { id: "b", order: 2, timeRatio: 0.5, prompt: "B", assetBindings: [] },
            { id: "c", order: 1, timeRatio: 0.1, prompt: "C", assetBindings: [] },
        ],
    }));
    assert.deepEqual(sortStoryboardKeyframes(items).map((item) => item.id), ["c", "b", "a"]);
});

test("关键帧资产覆盖同 nodeId 的行级 role/priority，并保留额外资产", () => {
    const current = normalizeStoryboardKeyframes(row({
        keyframePromptDescriptions: [{ id: "kf-1", prompt: "动作", assetBindings: [
            { nodeId: "row-asset", role: "prop", priority: 9 },
            { nodeId: "frame-asset", role: "character", priority: 2 },
        ] }],
    }))[0]!;
    assert.deepEqual(effectiveStoryboardKeyframeAssets(row(), current), [
        { nodeId: "row-asset", role: "prop", priority: 9 },
        { nodeId: "frame-asset", role: "character", priority: 2 },
    ]);
});

test("单帧同时作为首尾帧，复制映射后不会复用关键帧和节点 ID", () => {
    const source = row({
        keyframeGroupNodeId: "group-1",
        keyframePromptDescriptions: [{ id: "kf-1", order: 0, timeRatio: 0, prompt: "唯一画面", imageNodeId: "image-1", assetBindings: [] }],
        imageNodeId: "legacy-image",
        videoNodeId: "video-1",
    });
    const copied = remapStoryboardKeyframeReferences(source, new Map([
        ["group-1", "group-2"],
        ["image-1", "image-2"],
        ["legacy-image", "legacy-image-2"],
        ["video-1", "video-2"],
    ]));
    assert.equal(copied.keyframeGroupNodeId, "group-2");
    assert.equal(copied.keyframePromptDescriptions?.[0]?.imageNodeId, "image-2");
    assert.notEqual(copied.keyframePromptDescriptions?.[0]?.id, "kf-1");
    assert.equal(copied.imageNodeId, "legacy-image-2");
    assert.equal(copied.videoNodeId, "video-2");
    assert.equal(CanvasNodeType.KeyframeGroup, "keyframe-group");
});
