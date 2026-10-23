import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNodeType, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";
import { isolateCopiedNodeMetadata } from "./canvas-node-copy";
import { removeCanvasNodes } from "./canvas-project-domain";

function row(): StoryboardRow {
    return {
        id: "shot-1", shotNumber: 1, durationSeconds: 6, plotDescription: "", dialogue: "", characters: [], narrativeIntent: "", viewerPOV: "", performanceBlocking: "", shotSize: "", emotion: "", lightingAndAtmosphere: "", audioEffects: "", camera: "", motion: "", timeBeats: "", imageGenerationPrompt: "", videoMotionPrompt: "", mustHave: [], optionalDetails: [], continuityOut: "", negativePrompt: "", assetBindings: [], keyframeGroupNodeId: "group-1", keyframePromptDescriptions: [{ id: "kf-1", order: 0, timeRatio: 0, prompt: "画面", assetBindings: [], imageNodeId: "image-1" }],
    };
}

function node(id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

test("删除关键帧图片会同步移除行内图片绑定并保留关键帧描述", () => {
    const script = node("script", CanvasNodeType.Script, { storyboard: { rows: [row()], visibleColumns: ["keyframes"], referenceNodeIds: [] } });
    const image = node("image-1", CanvasNodeType.Image, { storyboardNodeId: script.id, rowId: "shot-1", keyframeGroupNodeId: "group-1", keyframeId: "kf-1" });
    const result = removeCanvasNodes([script, image], new Set([image.id]));
    const savedRow = result.nodes.find((item) => item.id === script.id)?.metadata?.storyboard?.rows[0];
    assert.equal(result.removedIds.has(image.id), true);
    assert.deepEqual(savedRow?.keyframePromptDescriptions?.map((item) => item.imageNodeId), []);
});

test("复制分镜行会映射组与图片节点，并生成新的关键帧 ID", () => {
    const script = node("script", CanvasNodeType.Script, { storyboard: { rows: [row()], visibleColumns: ["keyframes"], referenceNodeIds: [] } });
    const copied = isolateCopiedNodeMetadata(script, new Map([["group-1", "group-2"], ["image-1", "image-2"]]));
    const copiedRow = copied.storyboard?.rows[0];
    assert.equal(copiedRow?.keyframeGroupNodeId, "group-2");
    assert.equal(copiedRow?.keyframePromptDescriptions?.[0]?.imageNodeId, "image-2");
    assert.equal(copiedRow?.keyframePromptDescriptions?.[0]?.id, "keyframe-image-2");
    const copiedImage = isolateCopiedNodeMetadata(node("image-1", CanvasNodeType.Image, { keyframeId: "kf-1" }), new Map([["image-1", "image-2"]]));
    assert.equal(copiedImage.keyframeId, "keyframe-image-2");
});
