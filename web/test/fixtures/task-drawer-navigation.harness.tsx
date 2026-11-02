import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/tasks" });
const originals = new Map<string, PropertyDescriptor | undefined>();
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    CustomEvent: dom.CustomEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { MemoryRouter, useLocation } = await import("react-router");
const { default: TasksPage } = await import("../../src/pages/tasks");
const { apiClient } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");

console.info("Task details harness imports ready");

function RouteProbe() {
    return <output data-location>{useLocation().search}</output>;
}

test.each(["completed", "recover", "recovery-failed", "detail-failed"])("task row loads server details and media recovery preserves task identity: %s", async (state) => {
    const adapter = apiClient.defaults.adapter;
    const features = useUserStore.getState().features;
    useUserStore.setState({ features: { ...features, shortDramaEnabled: false } });
    const recovering = state === "recover" || state === "recovery-failed";
    const task = {
        id: "existing-task",
        type: "canvas_text",
        prompt: "服务端任务详情",
        status: recovering ? "failed" : "succeeded",
        attempts: 1,
        createdAt: "2026-10-21T00:00:00Z",
        updatedAt: "2026-10-21T00:00:00Z",
        ...(recovering ? { canRecoverMedia: true, mediaStage: "upload" } : { resultJson: JSON.stringify({ mode: "text", text: "对应任务的生成结果" }) }),
    };
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        let data: unknown;
        if (config.url === "/tasks") data = [{ ...task, prompt: "任务摘要" }];
        else if (config.url === "/tasks/existing-task/logs") data = [];
        else if (config.url === "/tasks/existing-task") {
            if (state === "detail-failed") throw new Error("服务端拒绝详情读取");
            data = task;
        } else if (config.url === "/tasks/existing-task/recover-media") {
            if (state === "recovery-failed") throw new Error("保存恢复失败");
            data = { ...task, status: "running", prompt: "同一任务正在恢复保存" };
        } else throw new Error(`Unexpected request: ${config.method} ${config.url}`);
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <MemoryRouter initialEntries={["/tasks?status=all"]}>
                    <App>
                        <TasksPage />
                        <RouteProbe />
                    </App>
                </MemoryRouter>,
            ),
        );
        const title = host.querySelector<HTMLButtonElement>(".task-record-title");
        expect(title?.textContent).toBe("任务摘要");
        await act(async () => title!.click());
        const drawer = document.querySelector(".ant-drawer-body");
        expect(drawer).not.toBeNull();
        expect(requests).toContain("get /tasks/existing-task");
        expect(requests).toContain("get /tasks/existing-task/logs");
        if (state === "detail-failed") {
            expect(drawer?.textContent).toContain("任务摘要");
            expect(document.body.textContent).toContain("服务端拒绝详情读取");
        } else if (recovering) {
            const retry = Array.from(drawer!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("重试保存"));
            expect(retry).toBeDefined();
            await act(async () => retry!.click());
            expect(requests.filter((request) => request.startsWith("post "))).toEqual(["post /tasks/existing-task/recover-media"]);
            if (state === "recover") {
                expect(drawer?.textContent).toContain("同一任务正在恢复保存");
                expect(host.querySelector("[data-location]")?.textContent).toBe("?status=active");
            } else {
                expect(document.body.textContent).toContain("保存恢复失败");
                expect(drawer?.textContent).toContain("服务端任务详情");
                expect(host.querySelector("[data-location]")?.textContent).toBe("?status=all");
            }
        } else {
            expect(drawer?.textContent).toContain("服务端任务详情");
            expect(drawer?.textContent).toContain("对应任务的生成结果");
            expect(requests.some((request) => request.startsWith("post "))).toBe(false);
        }
        await act(async () => document.querySelector<HTMLButtonElement>(".ant-drawer-close")!.click());
        expect(document.querySelector(".ant-drawer-open")).toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.defaults.adapter = adapter;
        useUserStore.setState({ features });
    }
});
