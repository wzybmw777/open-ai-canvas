import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AssetLibraryPickerModal } = await import("../src/components/assets/asset-library-picker-modal");
const sync = await import("../src/services/user-data-sync");
const assets = await import("../src/stores/use-asset-store");
const { useUserStore } = await import("../src/stores/use-user-store");
const { useLocaleStore } = await import("../src/lib/i18n");
import type { Asset } from "../src/stores/use-asset-store";

const initialUser = useUserStore.getState();
const initialLocale = useLocaleStore.getState();
const spies: Array<{ mockRestore: () => void }> = [];
const oldImage: Asset = { id: "old", title: "已有图片", kind: "image", category: "material", tags: [], coverUrl: "", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", data: { dataUrl: "data:image/png;base64,AA==", width: 1, height: 1, bytes: 1, mimeType: "image/png" } };
const newImage: Asset = { ...oldImage, id: "new", title: "刚上传.png" };

afterEach(() => {
    spies.splice(0).reverse().forEach((spy) => spy.mockRestore());
    useUserStore.setState(initialUser);
    useLocaleStore.setState(initialLocale);
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test.each([1, 2])("upload from page %i refreshes the all-types list and returns to the newest assets", async (startingPage) => {
    useUserStore.setState({ hydrated: true, user: { id: "upload-owner" } as NonNullable<typeof initialUser.user> });
    useLocaleStore.setState({ locale: "zh-CN" });
    let saved = false;
    spies.push(spyOn(assets, "flushAssetStorePersistence").mockResolvedValue(undefined));
    spies.push(spyOn(sync, "saveRemoteUserDataNow").mockImplementation(async () => { saved = true; }));
    spies.push(spyOn(sync, "loadAssetLibraryPage").mockImplementation(async ({ page, pageSize }) => ({
        assets: saved && page === 1 ? [newImage, oldImage] : [oldImage], total: saved ? 42 : 41,
        kindCounts: { image: saved ? 42 : 41 }, categoryCounts: { material: saved ? 42 : 41 }, folderCounts: {},
        page, pageSize, hasMore: page === 1,
    })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const filteredKey = ["asset-picker", "upload-owner", 1, 40, "all", "", "image"];
    client.setQueryData(filteredKey, { assets: [oldImage], total: 1 });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const picked: string[][] = [];
    try {
        await act(async () => {
            root.render(<QueryClientProvider client={client}><App><AssetLibraryPickerModal open remoteLibrary acceptRemoteItems items={[]} categoryLabels={{ all: "全部素材", material: "素材" }} upload={{ accept: "image/*", description: "上传图片", onUpload: async () => [newImage.id] }} onClose={() => {}} onConfirm={(ids) => { picked.push(ids); }} /></App></QueryClientProvider>);
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(document.querySelector('.asset-picker-card-action[title="已有图片"]')).not.toBeNull();
        if (startingPage === 2) {
            await act(async () => {
                document.querySelector<HTMLButtonElement>('.app-pagination-next')!.click();
                await new Promise((resolve) => setTimeout(resolve, 50));
            });
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
            expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("2");
        }
        const input = document.querySelector<HTMLInputElement>('.asset-picker-footer input[type="file"]')!;
        Object.defineProperty(input, "files", { configurable: true, value: [new dom.File(["image"], "刚上传.png", { type: "image/png" })] });
        await act(async () => {
            input.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(document.querySelector('.asset-picker-card-action[title="刚上传.png"]')?.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector(".asset-picker-count")?.textContent).toBe("已选 1 · 42 个素材");
        expect(document.querySelector('[aria-current="page"]')?.textContent).toBe("1");
        expect(client.getQueryState(filteredKey)?.isInvalidated).toBe(true);
        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("使用已选素材"))!;
        await act(async () => { confirm.click(); });
        expect(picked).toEqual([["new"]]);
    } finally {
        await act(async () => root.unmount());
        client.clear();
        host.remove();
    }
});
