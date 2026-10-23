import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNodeType, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";
import { appendStoryboardKeyframe, markStoryboardVideoStale, removeStoryboardKeyframe, reorderStoryboardKeyframes, updateStoryboardKeyframe } from "./canvas-storyboard-keyframe-sync";

function row(patch: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        id: "shot-1", shotNumber: 1, durationSeconds: 10, plotDescription: "剧情", dialogue: "", characters: [], narrativeIntent: "", viewerPOV: "",
        performanceBlocking: "", shotSize: "", emotion: "", lightingAndAtmosphere: "", audioEffects: "", camera: "", motion: "", timeBeats: "",
        imageGenerationPrompt: "首帧", videoMotionPrompt: "运动", mustHave: [], optionalDetails: [], continuityOut: "", negativePrompt: "", assetBindings: [],
        keyframePromptDescriptions: [
            { id: "a", order: 0, timeRatio: 0, prompt: "A", assetBindings: [] },
            { id: "b", order: 1, timeRatio: 0.5, prompt: "B", assetBindings: [] },
        ],
        ...patch,
    };
}

test("分镜行和组内编辑共享关键帧 ID，手动改提示词清除模板变量", () => {
    const next = updateStoryboardKeyframe(row(), "a", { prompt: "手动修改", promptTemplateVariables: { shot: "1" } });
    assert.equal(next.keyframePromptDescriptions?.[0]?.prompt, "手动修改");
    assert.equal(next.keyframePromptDescriptions?.[0]?.promptTemplateVariables, undefined);
});

test("新增、删除和排序保持稳定 ID 与派生数量", () => {
    const appended = appendStoryboardKeyframe(row(), { prompt: "结束", timeRatio: 1 }, "b");
    assert.equal(appended.keyframePromptDescriptions?.length, 3);
    assert.deepEqual(appended.keyframePromptDescriptions?.map((item) => item.order), [0, 1, 2]);
    const insertedId = appended.keyframePromptDescriptions?.[2]?.id || "";
    const reordered = reorderStoryboardKeyframes(appended, [insertedId, "a", "b"]);
    assert.deepEqual(reordered.keyframePromptDescriptions?.map((item) => item.id), [insertedId, "a", "b"]);
    assert.deepEqual(reordered.keyframePromptDescriptions?.map((item) => item.timeRatio), [0, 0.5, 1]);
    const removed = removeStoryboardKeyframe(reordered, "a");
    assert.equal(removed.keyframePromptDescriptions?.length, 2);
    assert.deepEqual(removed.keyframePromptDescriptions?.map((item) => item.order), [0, 1]);
});

test("关键帧变化会让当前视频节点标记为需要重新生成", () => {
    const video: CanvasNodeData = { id: "video-1", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { status: "success" } };
    const stale = markStoryboardVideoStale([video], row({ videoNodeId: video.id }));
    assert.equal(stale[0]?.metadata?.needsRegeneration, true);
});
