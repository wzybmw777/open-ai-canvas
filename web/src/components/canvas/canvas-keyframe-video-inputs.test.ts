import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";
import { buildStoryboardKeyframeVideoInput } from "./canvas-node-generation";

function row(count: number): StoryboardRow {
    return {
        id: "shot-1", shotNumber: 1, durationSeconds: 10, plotDescription: "", dialogue: "", characters: [], narrativeIntent: "", viewerPOV: "", performanceBlocking: "", shotSize: "", emotion: "", lightingAndAtmosphere: "", audioEffects: "", camera: "", motion: "", timeBeats: "", imageGenerationPrompt: "", videoMotionPrompt: "", mustHave: [], optionalDetails: [], continuityOut: "", negativePrompt: "", assetBindings: [],
        keyframePromptDescriptions: Array.from({ length: count }, (_, index) => ({ id: `kf-${index}`, order: index, timeRatio: count === 1 ? 0 : index / (count - 1), prompt: `帧 ${index}`, assetBindings: [], imageNodeId: `image-${index}` })),
    };
}

function node(id: string, type: CanvasNodeType): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: `${id}.png`, status: "success" } };
}

test("一张图既是首帧也是尾帧，双帧没有中间参考图", () => {
    const group = node("group", CanvasNodeType.KeyframeGroup);
    assert.deepEqual(buildStoryboardKeyframeVideoInput(group, [group, node("image-0", CanvasNodeType.Image)], [] as CanvasConnection[], row(1)), { orderedImageNodeIds: ["image-0"], startFrameNodeId: "image-0", endFrameNodeId: "image-0", referenceNodeIds: [] });
    assert.deepEqual(buildStoryboardKeyframeVideoInput(group, [group, node("image-0", CanvasNodeType.Image), node("image-1", CanvasNodeType.Image)], [], row(2)).referenceNodeIds, []);
});

test("多帧按时间顺序编译为首帧、尾帧和中间 reference_image", () => {
    const group = node("group", CanvasNodeType.KeyframeGroup);
    const result = buildStoryboardKeyframeVideoInput(group, [group, ...Array.from({ length: 7 }, (_, index) => node(`image-${index}`, CanvasNodeType.Image))], [], row(7));
    assert.deepEqual(result.orderedImageNodeIds, ["image-0", "image-1", "image-2", "image-3", "image-4", "image-5", "image-6"]);
    assert.equal(result.startFrameNodeId, "image-0");
    assert.equal(result.endFrameNodeId, "image-6");
    assert.deepEqual(result.referenceNodeIds, ["image-1", "image-2", "image-3", "image-4", "image-5"]);
});

test("关键帧图片缺失时直接报错，不静默截断输入", () => {
    const group = node("group", CanvasNodeType.KeyframeGroup);
    assert.throws(() => buildStoryboardKeyframeVideoInput(group, [group, node("image-0", CanvasNodeType.Image)], [], row(3)), /尚未生成或已丢失/);
});
