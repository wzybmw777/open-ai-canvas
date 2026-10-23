import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNodeType, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";
import { buildKeyframeGroupPresentation } from "@/components/canvas/canvas-keyframe-group-node";

function row(patch: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        id: "shot-1", shotNumber: 1, durationSeconds: 10, plotDescription: "", dialogue: "", characters: [],
        narrativeIntent: "", viewerPOV: "", performanceBlocking: "", shotSize: "", emotion: "", lightingAndAtmosphere: "",
        audioEffects: "", camera: "", motion: "", timeBeats: "", imageGenerationPrompt: "", videoMotionPrompt: "",
        mustHave: [], optionalDetails: [], continuityOut: "", negativePrompt: "", assetBindings: [], ...patch,
    };
}

function image(id: string, content?: string): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: content ? { content, status: "success" } : { status: "loading" } };
}

test("关键帧组展示按时间轴排序并把比例换算为秒数", () => {
    const presentation = buildKeyframeGroupPresentation(row({
        durationSeconds: 8,
        keyframePromptDescriptions: [
            { id: "end", order: 2, timeRatio: 1, prompt: "结束", assetBindings: [], imageNodeId: "image-end" },
            { id: "start", order: 0, timeRatio: 0, prompt: "起始", assetBindings: [], imageNodeId: "image-start" },
            { id: "middle", order: 1, timeRatio: 0.5, prompt: "过程", assetBindings: [], imageNodeId: "image-middle" },
        ],
    }), [image("image-start", "start.png"), image("image-middle"), image("image-end", "end.png")]);
    assert.deepEqual(presentation.map((item) => [item.keyframeId, item.seconds, item.image?.id]), [
        ["start", 0, "image-start"],
        ["middle", 4, "image-middle"],
        ["end", 8, "image-end"],
    ]);
});

test("缺少图片节点时展示可恢复状态，单帧仍可作为首尾帧", () => {
    const presentation = buildKeyframeGroupPresentation(row({
        durationSeconds: 5,
        keyframePromptDescriptions: [{ id: "only", order: 0, timeRatio: 0, prompt: "唯一画面", assetBindings: [], imageNodeId: "missing" }],
    }), []);
    assert.equal(presentation.length, 1);
    assert.equal(presentation[0]?.isFirst, true);
    assert.equal(presentation[0]?.isLast, true);
    assert.equal(presentation[0]?.image, undefined);
    assert.equal(presentation[0]?.state, "missing");
});
