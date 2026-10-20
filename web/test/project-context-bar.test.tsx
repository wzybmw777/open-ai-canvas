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
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { ProjectContextBar } = await import("../src/components/project-context-bar");
const api = await import("../src/services/api/user-data");
const creation = await import("../src/services/creation-project");
const { useUserStore } = await import("../src/stores/use-user-store");
const { useCanvasStore, withCanvasStorePersistenceSuppressed } = await import("../src/stores/canvas/use-canvas-store");
const initialUser = useUserStore.getState();
const initialCanvas = useCanvasStore.getState();
const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
    spies.splice(0).reverse().forEach((spy) => spy.mockRestore());
    useUserStore.setState(initialUser);
    withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState(initialCanvas));
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("returning after deleting the default waits for fresh canvas data before selecting a replacement", async () => {
    useUserStore.setState({ user: { id: "context-owner" } as NonNullable<typeof initialUser.user> });
    withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ hydrated: true }));
    let finish!: (id: string) => void;
    spies.push(spyOn(creation, "ensureDefaultCreationProject").mockImplementation(() => new Promise((resolve) => { finish = resolve; })));
    spies.push(spyOn(api, "listRemoteCanvasProjects").mockResolvedValue({ projects: [{ id: "replacement", title: "默认项目", createdAt: "", updatedAt: "" }] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(["canvas-library", "context-owner", "creation-context"], { defaultId: "deleted", projects: [{ id: "deleted", title: "默认项目" }] });
    const selected: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><ProjectContextBar onChange={(id) => selected.push(id)} description="" /></MemoryRouter></QueryClientProvider>));
        expect(selected).toEqual([]);
        expect(host.querySelector("a")?.getAttribute("href")).toBe("/projects");
        await act(async () => {
            finish("replacement");
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(selected).toEqual(["replacement"]);
        expect(host.querySelector('[role="combobox"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        client.clear();
        host.remove();
    }
});
