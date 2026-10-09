import { describe, expect, it } from "bun:test";

import { buildStoryboardAssetCatalog, isStoryboardBindableAsset } from "@/lib/canvas/canvas-storyboard-assets";
import { MAX_STORYBOARD_ROW_ASSETS, reconcileStoryboardTargetConnections, setStoryboardAssetBinding, storyboardComposerContent, storyboardRowReferenceNodeIds } from "@/lib/canvas/canvas-storyboard-materializer";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";

const node = (id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata,
});

const row: StoryboardRow = {
    id: "row-1",
    shotNumber: 1,
    durationSeconds: 6,
    plotDescription: "雨夜追逐",
    dialogue: "快走",
    characters: [{ characterName: "林岚", characterAssetId: "character-asset" }],
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
    imageGenerationPrompt: "",
    videoMotionPrompt: "快速跟拍",
    mustHave: [],
    optionalDetails: [],
    continuityOut: "",
    negativePrompt: "",
    assetBindings: [{ nodeId: "prop", role: "prop", priority: 80 }],
    imageNodeId: "first-frame",
    status: "idle",
};

describe("storyboard asset catalog", () => {
    it("sends reusable image, video, audio and character assets but excludes generated shots", () => {
        const assets = buildStoryboardAssetCatalog([
            node("image", CanvasNodeType.Image, { content: "data:image/png;base64,x", assetCategory: "environment" }),
            node("video", CanvasNodeType.Video, { storageKey: "resource:video" }),
            node("audio", CanvasNodeType.Audio, { content: "data:audio/wav;base64,x" }),
            node("character", CanvasNodeType.Image, { workflowKind: "character", characterAssetId: "character-asset", characterVersionId: "v1" }),
            node("shot", CanvasNodeType.Image, { content: "data:image/png;base64,x", workflowKind: "shot" }),
            node("text", CanvasNodeType.Text, { content: "story" }),
        ]);

        expect(assets.map((asset) => [asset.id, asset.type])).toEqual([
            ["image", "image"],
            ["video", "video"],
            ["audio", "audio"],
            ["character", "character"],
        ]);
    });

    it("binds reusable assets once, preserves existing roles and removes missing assets", () => {
        const character = node("character", CanvasNodeType.Image, { workflowKind: "character", characterAssetId: "hero", characterVersionId: "v1" });
        const scene = node("scene", CanvasNodeType.Image, { storageKey: "resource:scene", assetCategory: "environment" });
        const shot = node("shot", CanvasNodeType.Image, { storageKey: "resource:shot", workflowKind: "shot" });
        expect(isStoryboardBindableAsset(shot)).toBe(false);

        const withCharacter = setStoryboardAssetBinding([], character, true);
        expect(withCharacter).toEqual([{ nodeId: "character", role: "character", priority: 100 }]);
        expect(setStoryboardAssetBinding(withCharacter, character, true)).toEqual(withCharacter);
        const withScene = setStoryboardAssetBinding(withCharacter, scene, true);
        expect(withScene).toEqual([...withCharacter, { nodeId: "scene", role: "environment", priority: 90 }]);
        expect(setStoryboardAssetBinding(withScene, shot, true)).toEqual(withScene);
        expect(setStoryboardAssetBinding(withScene, node("missing", CanvasNodeType.Image), false)).toEqual(withScene);
        expect(setStoryboardAssetBinding(withScene, character, false)).toEqual([{ nodeId: "scene", role: "environment", priority: 90 }]);
    });

    it("caps manual bindings at the same per-row limit as the agent", () => {
        const bindings = Array.from({ length: MAX_STORYBOARD_ROW_ASSETS }, (_, index) => ({ nodeId: `asset-${index}`, role: "style" as const, priority: 60 }));
        const extra = node("extra", CanvasNodeType.Image, { storageKey: "resource:extra" });
        expect(setStoryboardAssetBinding(bindings, extra, true)).toEqual(bindings);
        expect(setStoryboardAssetBinding(bindings, node("asset-0", CanvasNodeType.Image), false)).toHaveLength(MAX_STORYBOARD_ROW_ASSETS - 1);
    });
});

describe("storyboard target materializer", () => {
    const script = node("script", CanvasNodeType.Script, { storyboard: { rows: [row], visibleColumns: [], referenceNodeIds: ["project-style"] } });
    const nodes = [script, node("project-style", CanvasNodeType.Image, { content: "style" }), node("prop", CanvasNodeType.Image, { content: "prop" }), node("character", CanvasNodeType.Image, { workflowKind: "character", characterAssetId: "character-asset" }), node("manual", CanvasNodeType.Video, { content: "video" }), node("direct-manual", CanvasNodeType.Audio, { content: "audio" }), node("first-frame", CanvasNodeType.Image, { content: "frame", workflowKind: "shot" }), node("target", CanvasNodeType.Video)];
    const connections: CanvasConnection[] = [{ id: "manual-row-input", fromNodeId: "manual", toNodeId: "script", toHandleId: "row:row-1" }];

    it("combines stable bindings and produces position mention tokens", () => {
        const references = storyboardRowReferenceNodeIds(script, row, nodes, connections, true);
        expect(references).toEqual(["project-style", "prop", "character", "manual", "first-frame"]);
        expect(storyboardComposerContent("快速跟拍", references, nodes)).toBe("参考资产：@图片1 @图片2 @角色3 @视频1 @图片4\n快速跟拍");

        const withDirectManualInput = storyboardRowReferenceNodeIds(script, row, nodes, [...connections, { id: "direct", fromNodeId: "direct-manual", toNodeId: "target" }], false, "target");
        expect(withDirectManualInput).toContain("direct-manual");
    });

    it("reconciles managed edges without deleting manual connections", () => {
        const manualTargetEdge: CanvasConnection = { id: "manual-target", fromNodeId: "manual", toNodeId: "target" };
        const created = reconcileStoryboardTargetConnections([manualTargetEdge], script, row, "target", ["prop", "character"]);
        expect(created.filter((edge) => edge.relation === "storyboard-output")).toHaveLength(1);
        expect(created.filter((edge) => edge.relation === "storyboard-asset-reference").map((edge) => edge.fromNodeId).sort()).toEqual(["character", "prop"]);

        const reconciled = reconcileStoryboardTargetConnections(created, script, row, "target", ["character"]);
        expect(reconciled.some((edge) => edge.id === "manual-target")).toBe(true);
        expect(reconciled.some((edge) => edge.relation === "storyboard-asset-reference" && edge.fromNodeId === "prop")).toBe(false);
    });

    it("includes a newly selected row asset in the next video reference list", () => {
        const added = node("new-scene", CanvasNodeType.Image, { storageKey: "resource:new-scene", assetCategory: "environment" });
        const updated = { ...row, assetBindings: setStoryboardAssetBinding(row.assetBindings, added, true) };
        const references = storyboardRowReferenceNodeIds(script, updated, [...nodes, added], connections, false);
        expect(references).toContain("new-scene");
        expect(storyboardComposerContent(updated.videoMotionPrompt, references, [...nodes, added])).toContain("@图片3");
    });
});
