import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConnectedReferenceShelf } = await import("../src/components/canvas/canvas-node-prompt-references");
const { canvasThemes } = await import("../src/lib/canvas-theme");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { useCanvasUpload } = await import("../src/pages/canvas/use-canvas-upload");
const resources = await import("../src/services/api/resources");
const assetSync = await import("../src/services/project-asset-sync");
const generation = await import("../src/lib/canvas/canvas-project-generation");
const { useCanvasGenerationRetry } = await import("../src/pages/canvas/use-canvas-generation-retry");
const { disconnectCanvasNodeReference } = await import("../src/lib/canvas/canvas-node-references");
const { useConfigStore } = await import("../src/stores/use-config-store");
const { skillRuntime } = await import("../src/services/skill-runtime");
const { CanvasNodeType } = await import("../src/types/canvas");
import type { CanvasNodeData } from "../src/types/canvas";

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("an empty shelf exposes all add-reference actions", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const actions: string[] = [];
    try {
        await act(async () => root.render(<ConnectedReferenceShelf references={[]} theme={canvasThemes.dark} onInsert={() => {}} onAdd={(action) => actions.push(action)} />));
        const add = host.querySelector<HTMLButtonElement>('button[aria-label="添加参考节点"]');
        expect(add).not.toBeNull();
        await act(async () => { add!.click(); });
        for (const label of ["选择画布节点", "从素材库添加", "上传本地文件", "新建文本节点"]) expect(document.body.textContent).toContain(label);
        const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((element) => element.textContent?.includes("选择画布节点"))!;
        await act(async () => item.click());
        expect(actions).toEqual(["canvas"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("remove invokes only the association callback and explains that source media is kept", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const reference = { id: "source", nodeId: "source", kind: "image" as const, label: "图片1", title: "角色参考", active: true };
    const removed: string[] = [];
    try {
        await act(async () => root.render(<ConnectedReferenceShelf references={[reference]} theme={canvasThemes.dark} onInsert={() => {}} onRemove={(item) => removed.push(item.nodeId)} />));
        const remove = host.querySelector<HTMLButtonElement>('button[aria-label="移除参考 图片1"]')!;
        expect(remove.title).toContain("保留原素材");
        await act(async () => remove.click());
        expect(removed).toEqual(["source"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("reference uploads preserve selection and skip writes after the target scope expires", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const nodesRef = { current: [] as CanvasNodeData[] };
    const selections: string[] = [];
    const upload = spyOn(resources, "uploadResourceFile").mockResolvedValue({ id: "text-resource" } as Awaited<ReturnType<typeof resources.uploadResourceFile>>);
    const persist = spyOn(assetSync, "ensureCanvasNodeAsset").mockResolvedValue({ assetId: "text-asset" } as Awaited<ReturnType<typeof assetSync.ensureCanvasNodeAsset>>);
    let runtime: ReturnType<typeof useCanvasUpload>;
    function Harness() {
        runtime = useCanvasUpload({
            canvasId: "canvas", nodesRef, selectedNodeIdsRef: { current: new Set() }, getCanvasCenter: () => ({ x: 0, y: 0 }), screenToCanvas: () => ({ x: 0, y: 0 }),
            setNodes: (update) => { nodesRef.current = typeof update === "function" ? update(nodesRef.current) : update; },
            setSelectedNodeIds: () => { selections.push("selection"); }, setSelectedConnectionId: () => {}, setContextMenu: () => {}, setDialogNodeId: () => { selections.push("dialog"); },
        });
        return null;
    }
    try {
        await act(async () => root.render(<QueryClientProvider client={client}><App><Harness /></App></QueryClientProvider>));
        const file = new File(["人物设定"], "参考.txt", { type: "text/plain" });
        await act(async () => { await runtime!.createFileNode(file, { x: 0, y: 0 }, undefined, { preserveSelection: true }); });
        expect(selections).toEqual([]);
        expect(nodesRef.current).toHaveLength(1);
        expect(nodesRef.current[0].metadata?.content).toBe("人物设定");
        let current = true;
        let result: string | null = "pending";
        const before = nodesRef.current;
        await act(async () => {
            const pending = runtime!.createFileNode(file, { x: 0, y: 0 }, undefined, { preserveSelection: true, isCurrent: () => current });
            current = false;
            result = await pending;
        });
        expect(result).toBeNull();
        expect(nodesRef.current).toBe(before);
        expect(upload).toHaveBeenCalledTimes(1);
    } finally {
        upload.mockRestore(); persist.mockRestore();
        await act(async () => root.unmount());
        client.clear(); host.remove();
    }
});

test("regenerate after detaching a reference uses current inputs instead of saved request images", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const originalConfig = useConfigStore.getState();
    useConfigStore.setState({ isAiConfigReady: () => true });
    const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Image, title: "source", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { content: "data:image/png;base64,AA==" } };
    const target: CanvasNodeData = { ...source, id: "target", metadata: { prompt: "旧提示词", composerContent: "@图片1 新提示词", status: "error", generationType: "edit", references: [source.metadata!.content!] } };
    const detached = disconnectCanvasNodeReference([source, target], [{ id: "edge", fromNodeId: source.id, toNodeId: target.id }], target.id, source.id);
    const nodesRef = { current: detached.nodes };
    const submitted: Parameters<typeof generation.runCanvasGenerationTaskToConsumer>[0][] = [];
    const submit = spyOn(generation, "runCanvasGenerationTaskToConsumer").mockImplementation(async (input) => { submitted.push(input); return undefined as never; });
    const oldReferences = spyOn(generation, "resolveMetadataReferences").mockResolvedValue([{ id: "historical", dataUrl: source.metadata!.content!, width: 1, height: 1 }]);
    const skills = spyOn(skillRuntime, "prepare").mockImplementation(async ({ prompt }) => ({ prompt, metadata: { skillIds: [], skillVersions: [], skillFiles: [] } }));
    let retry: ReturnType<typeof useCanvasGenerationRetry>;
    function Harness() {
        retry = useCanvasGenerationRetry({ projectId: "canvas", addedSkills: [], assets: [], nodesRef, connectionsRef: { current: detached.connections },
            setNodes: (update) => { nodesRef.current = typeof update === "function" ? update(nodesRef.current) : update; },
            setRunningNodeId: () => {}, startGenerationRequest: () => new AbortController(), finishGenerationRequest: () => {}, bindGenerationTask: () => {}, applyGenerationTaskResult: async () => {},
        });
        return null;
    }
    try {
        await act(async () => root.render(<App><Harness /></App>));
        await act(async () => { await retry!(nodesRef.current[1]); });
        expect(submitted).toHaveLength(1);
        expect(submitted[0].referenceImages).toEqual([]);
        expect(submitted[0].prompt).toContain("新提示词");
        expect(oldReferences).not.toHaveBeenCalled();
        expect(nodesRef.current[1].metadata?.references).toEqual([]);
        expect(nodesRef.current[1].metadata?.generationType).toBe("generation");
    } finally {
        submit.mockRestore(); oldReferences.mockRestore(); skills.mockRestore();
        await act(async () => root.unmount());
        useConfigStore.setState(originalConfig); host.remove();
    }
});
