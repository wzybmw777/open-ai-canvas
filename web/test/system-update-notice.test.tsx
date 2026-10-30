import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SystemUpdateNotice } = await import("../src/components/layout/system-update-notice");
const { apiClient } = await import("../src/services/api/request");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("the real notice preserves an editor through updating, downtime and recovery", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    let response: boolean | Error = true;
    apiClient.defaults.adapter = async (config) => {
        if (response instanceof Error) throw response;
        return { config, data: { code: 0, data: { updating: response }, msg: "ok" }, status: 200, statusText: "OK", headers: {} };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const reconnect = async () => {
        await act(async () => {
            window.dispatchEvent(new dom.Event("online"));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    };
    try {
        await act(async () => {
            root.render(<StrictMode><textarea defaultValue="未保存的内容" /><SystemUpdateNotice /></StrictMode>);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const editor = host.querySelector("textarea")!;
        expect(host.querySelector('[role="status"]')?.textContent).toContain("系统更新中");
        expect(host.querySelector("button")).toBeNull();
        response = new Error("connection reset during restart");
        await reconnect();
        expect(host.querySelector('[role="status"]')?.textContent).toContain("系统更新中");
        response = false;
        await reconnect();
        expect(host.querySelector('[role="status"]')?.textContent).toContain("系统服务已恢复");
        expect([...host.querySelectorAll("button")].some((button) => button.textContent === "刷新页面")).toBe(true);
        expect(host.querySelector("textarea")).toBe(editor);
        expect(editor.value).toBe("未保存的内容");
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="稍后刷新"]')!.click());
        expect(host.querySelector('[role="status"]')).toBeNull();
        expect(host.querySelector("textarea")).toBe(editor);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.defaults.adapter = originalAdapter;
    }
});

test("an unavailable updater does not report a healthy site as offline and recovery preserves edits", async () => {
    const originalAdapter = apiClient.defaults.adapter;
    let ready = true;
    apiClient.defaults.adapter = async (config) => {
        if (config.url === "/public/system-update") throw new Error("update status is unreachable");
        if (config.url !== "/health/ready") throw new Error("unexpected probe path");
        if (!ready) throw new Error("backend offline");
        return { config, data: { code: 0, data: { ready: true }, msg: "ok" }, status: 200, statusText: "OK", headers: {} };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const reconnect = async () => {
        await act(async () => {
            window.dispatchEvent(new dom.Event("online"));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    };
    try {
        await act(async () => {
            root.render(<StrictMode><textarea defaultValue="保留我的编辑" /><SystemUpdateNotice /></StrictMode>);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const editor = host.querySelector("textarea")!;
        expect(Boolean(host.querySelector('[role="status"]'))).toBe(false);
        ready = false;
        await reconnect();
        expect(host.querySelector('[role="status"]')?.textContent).toContain("正在自动重连");
        ready = true;
        await reconnect();
        expect(host.querySelector('[role="status"]')?.textContent).toContain("系统服务已恢复");
        expect(host.querySelector("textarea")).toBe(editor);
        expect(editor.value).toBe("保留我的编辑");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.defaults.adapter = originalAdapter;
    }
});
