import { describe, expect, test } from "bun:test";
import { getGenerationResourceNodes, buildCanvasNodeMentionReferenceMap, applyCanvasConnectionPromptSync } from "../src/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../src/types/canvas";
import { connectCanvasNodeReferences, disconnectCanvasNodeReference, reorderCanvasNodeReferences } from "../src/lib/canvas/canvas-node-references";
import { nodeGenerationPrompt } from "../src/lib/canvas/generation-contract";
import { useConfigStore } from "../src/stores/use-config-store";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { createStoryboardRow } from "../src/lib/canvas/canvas-project-domain";
import { connectCanvasTextMention } from "../src/lib/canvas/canvas-text-mention";

const config = useConfigStore.getState().config;

function node(id: string, type = CanvasNodeType.Image, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 200, height: 160, metadata: { content: `https://example.com/${id}.png`, ...metadata } };
}
const edge = (from: string, to: string): CanvasConnection => ({ id: `${from}-${to}`, fromNodeId: from, toNodeId: to });

describe("target-specific reference exclusions", () => {
    test("does not restore a removed inherited batch reference in presentation or generation", () => {
        const source = node("source");
        const root = node("root", CanvasNodeType.Image, { isBatchRoot: true });
        const target = node("target", CanvasNodeType.Image, { batchRootId: root.id, excludedReferenceNodeIds: [source.id] });
        const sibling = node("sibling", CanvasNodeType.Image, { batchRootId: root.id });
        const nodes = [source, root, target, sibling];
        const edges = [edge(source.id, root.id), edge(root.id, target.id), edge(root.id, sibling.id)];
        expect(getGenerationResourceNodes(target.id, nodes, edges)).toEqual([]);
        expect(buildCanvasNodeMentionReferenceMap(nodes, edges).get(target.id)).toEqual([]);
        expect(getGenerationResourceNodes(sibling.id, nodes, edges).map((item) => item.id)).toEqual([source.id]);
    });
});

describe("reference node graph actions", () => {
    test("reconnecting a detached reference with a normal canvas edge restores generation input", () => {
        const nodes = [node("source"), node("target")];
        const removed = disconnectCanvasNodeReference(nodes, [edge("source", "target")], "target", "source");
        const restoredEdges = [...removed.connections, edge("source", "target")];
        const restoredNodes = applyCanvasConnectionPromptSync(removed.nodes, removed.connections, removed.nodes, restoredEdges);
        expect(getGenerationResourceNodes("target", restoredNodes, restoredEdges).map((item) => item.id)).toEqual(["source"]);
    });

    test("a text mention restores a shared config reference even when its source edge already exists", () => {
        const nodes = [node("source", CanvasNodeType.Text, { content: "参考设定" }), node("target", CanvasNodeType.Image, { content: undefined }), node("config", CanvasNodeType.Config)];
        const edges = [edge("target", "config"), edge("source", "config")];
        const removed = disconnectCanvasNodeReference(nodes, edges, "target", "source");
        const restored = connectCanvasTextMention(removed.nodes, removed.connections, "target", "source", "unused");
        expect(restored.reference.nodeId).toBe("source");
        expect(restored.connections).toEqual(edges);
    });

    test("automatically rematerializing storyboard edges does not restore a deliberately detached reference", () => {
        const nodes = [node("source"), node("target", CanvasNodeType.Image, { excludedReferenceNodeIds: ["source"] })];
        const edges = [{ ...edge("source", "target"), storyboardRowId: "row" }];
        const synced = applyCanvasConnectionPromptSync(nodes, [], nodes, edges);
        expect(getGenerationResourceNodes("target", synced, edges)).toEqual([]);
    });
    test("reorders mixed config and direct references on the target without changing siblings", () => {
        const nodes = [node("a"), node("b"), node("target", CanvasNodeType.Image, { content: undefined, prompt: "@图片1 左侧，@图片2 右侧" }), node("sibling", CanvasNodeType.Image, { content: undefined }), node("config", CanvasNodeType.Config)];
        const edges = [edge("target", "config"), edge("sibling", "config"), edge("a", "config"), edge("b", "target")];
        const result = reorderCanvasNodeReferences(nodes, edges, "target", ["b", "a"]);
        expect(getGenerationResourceNodes("target", result.nodes, result.connections).map((item) => item.id)).toEqual(["b", "a"]);
        expect(getGenerationResourceNodes("sibling", result.nodes, result.connections).map((item) => item.id)).toEqual(["a"]);
        expect(nodeGenerationPrompt(result.nodes[2])).toBe("@图片2 左侧，@图片1 右侧");
        expect(result.connections).toBe(edges);
    });
    test("storyboard bindings are detached from one output without deleting row assets or sibling inputs", () => {
        const source = node("prop");
        const image = node("image-target", CanvasNodeType.Image, { content: undefined, prompt: "参考资产：@图片1\n人物动作不变" });
        const video = node("video-target", CanvasNodeType.Video, { content: undefined });
        const row = createStoryboardRow(1, { imageNodeId: image.id, videoNodeId: video.id, assetBindings: [{ nodeId: source.id, role: "prop", priority: 80 }] });
        const script = node("script", CanvasNodeType.Script, { storyboard: { rows: [row], referenceNodeIds: [], visibleColumns: [] } });
        const nodes = [source, image, video, script];
        const result = disconnectCanvasNodeReference(nodes, [], image.id, source.id);
        expect(result.nodes[3]).toBe(script);
        expect(getGenerationResourceNodes(image.id, result.nodes, result.connections)).toEqual([]);
        expect(getGenerationResourceNodes(video.id, result.nodes, result.connections).map((item) => item.id)).toEqual([source.id]);
        const context = buildNodeGenerationContext(image.id, result.nodes, result.connections, nodeGenerationPrompt(result.nodes[1]), []);
        expect(context.referenceImages).toEqual([]);
        expect(context.prompt).toContain("人物动作不变");
    });

    test("adding a reference to a batch child retains its inherited references without changing the root", () => {
        const nodes = [node("old"), node("new"), node("root", CanvasNodeType.Image, { isBatchRoot: true }), node("child", CanvasNodeType.Image, { batchRootId: "root" })];
        const edges = [edge("old", "root"), edge("root", "child")];
        const linked = connectCanvasNodeReferences(nodes, edges, "child", ["new"], config, () => crypto.randomUUID());
        expect(getGenerationResourceNodes("child", linked.nodes, linked.connections).map((item) => item.id)).toEqual(["old", "new"]);
        expect(getGenerationResourceNodes("root", linked.nodes, linked.connections).map((item) => item.id)).toEqual(["old"]);
        const context = buildNodeGenerationContext("child", linked.nodes, linked.connections, nodeGenerationPrompt(linked.nodes[3]), []);
        expect(context.referenceImages).toHaveLength(2);
    });

    test("automatically adding a mention retains previously implicit generation inputs", () => {
        const nodes = [node("old"), node("new"), node("target", CanvasNodeType.Image, { content: undefined, prompt: "人物肖像" })];
        const linked = connectCanvasNodeReferences(nodes, [edge("old", "target")], "target", ["new"], config, () => "new-edge");
        const context = buildNodeGenerationContext("target", linked.nodes, linked.connections, nodeGenerationPrompt(linked.nodes[2]), []);
        expect(context.referenceImages).toHaveLength(2);
        expect(nodeGenerationPrompt(linked.nodes[2])).toContain("@图片1 @图片2");
    });
    test("connects multiple nodes, inserts references once and preserves prompt content", () => {
        const nodes = [node("image"), node("text", CanvasNodeType.Text, { content: "人物设定" }), node("target", CanvasNodeType.Image, { content: undefined, prompt: "保持背景不变" })];
        const linked = connectCanvasNodeReferences(nodes, [], "target", ["image", "text"], config, () => crypto.randomUUID());
        expect(linked.connections.map((item) => item.fromNodeId)).toEqual(["image", "text"]);
        const prompt = nodeGenerationPrompt(linked.nodes[2]);
        expect(prompt).toBe("参考资产：@图片1 @文本1\n保持背景不变");
        const repeated = connectCanvasNodeReferences(linked.nodes, linked.connections, "target", ["image"], config, () => "duplicate");
        expect(repeated.connections).toHaveLength(2);
        expect(nodeGenerationPrompt(repeated.nodes[2])).toBe(prompt);
    });

    test("disconnect removes only the target association and mentions, retaining sources and other edges", () => {
        const source = node("source");
        const target = node("target", CanvasNodeType.Image, { content: undefined, prompt: "参考资产：@图片1\n保持背景不变" });
        const other = node("other");
        const nodes = [source, target, other];
        const edges = [edge(source.id, target.id), edge(source.id, other.id)];
        const result = disconnectCanvasNodeReference(nodes, edges, target.id, source.id);
        expect(result.nodes[0]).toBe(source);
        expect(result.nodes).toHaveLength(3);
        expect(result.connections).toEqual([edges[1]]);
        expect(nodeGenerationPrompt(result.nodes[1])).not.toContain("@图片1");
        expect(getGenerationResourceNodes(target.id, result.nodes, result.connections)).toEqual([]);
        const restored = connectCanvasNodeReferences(result.nodes, result.connections, target.id, [source.id], config, () => "restored");
        expect(getGenerationResourceNodes(target.id, restored.nodes, restored.connections).map((item) => item.id)).toEqual([source.id]);
        expect(nodeGenerationPrompt(restored.nodes[1])).toContain("@图片1");
    });

    test("shared config removal and additions affect only the chosen target", () => {
        const nodes = [node("source"), node("new-source"), node("target"), node("sibling"), node("config", CanvasNodeType.Config)];
        const edges = [edge("target", "config"), edge("sibling", "config"), edge("source", "config")];
        const removed = disconnectCanvasNodeReference(nodes, edges, "target", "source");
        expect(removed.connections).toEqual(edges);
        expect(getGenerationResourceNodes("target", removed.nodes, removed.connections).map((item) => item.id)).not.toContain("source");
        expect(getGenerationResourceNodes("sibling", removed.nodes, removed.connections).map((item) => item.id)).toContain("source");
        const added = connectCanvasNodeReferences(removed.nodes, removed.connections, "target", ["new-source"], config, () => "new-edge");
        expect(getGenerationResourceNodes("target", added.nodes, added.connections).map((item) => item.id)).toContain("new-source");
        expect(getGenerationResourceNodes("sibling", added.nodes, added.connections).map((item) => item.id)).not.toContain("new-source");
    });

    test("disconnecting inherited references persists without a direct edge", () => {
        const nodes = [node("source"), node("root", CanvasNodeType.Image, { isBatchRoot: true }), node("target", CanvasNodeType.Image, { batchRootId: "root", composerContent: "@图片1 人物动作不变" })];
        const edges = [edge("source", "root"), edge("root", "target")];
        const result = disconnectCanvasNodeReference(nodes, edges, "target", "source");
        expect(result.connections).toEqual(edges);
        expect(getGenerationResourceNodes("target", result.nodes, result.connections)).toEqual([]);
        expect(nodeGenerationPrompt(result.nodes[2])).toBe("人物动作不变");
        expect(getGenerationResourceNodes("root", result.nodes, result.connections).map((item) => item.id)).toEqual(["source"]);
    });

    test("invalid selections, cycles, locked targets and incompatible media fail atomically", () => {
        const nodes = [node("image"), node("video", CanvasNodeType.Video), node("target")];
        const edges: CanvasConnection[] = [];
        expect(() => connectCanvasNodeReferences(nodes, edges, "target", ["image", "video"], config, () => "new")).toThrow("参考视频");
        expect(edges).toEqual([]);
        expect(nodes[2].metadata?.composerContent).toBeUndefined();
        expect(() => connectCanvasNodeReferences(nodes, [edge("target", "image")], "target", ["image"], config, () => "new")).toThrow("循环");
        expect(() => connectCanvasNodeReferences(nodes, edges, "target", ["target"], config, () => "new")).toThrow();
        const locked = nodes.map((item) => item.id === "target" ? { ...item, metadata: { ...item.metadata, locked: true } } : item);
        expect(() => connectCanvasNodeReferences(locked, edges, "target", ["image"], config, () => "new")).toThrow("锁定");
        expect(() => disconnectCanvasNodeReference(locked, edges, "target", "image")).toThrow("锁定");
        expect(() => connectCanvasNodeReferences(nodes, edges, "missing", ["image"], config, () => "new")).toThrow();
    });
});
