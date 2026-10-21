import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/rewards" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, ShadowRoot: dom.ShadowRoot, CustomEvent: dom.CustomEvent, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { MemoryRouter, Routes, Route, useLocation, useNavigate } = await import("react-router");
const { default: RewardsPage } = await import("../src/pages/rewards");
const { apiClient } = await import("../src/services/api/request");
const { useLocaleStore } = await import("../src/lib/i18n");
const { useUserStore } = await import("../src/stores/use-user-store");
const { default: localforage } = await import("localforage");
const storage = new Map<string, unknown>();
const storageSpies = [
    spyOn(localforage, "getItem").mockImplementation(async (key) => storage.get(key) ?? null),
    spyOn(localforage, "setItem").mockImplementation(async (key, value) => { storage.set(key, value); return value; }),
];

afterAll(() => {
    dom.happyDOM.abort();
    storageSpies.forEach((spy) => spy.mockRestore());
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function RouteProbe() {
    const location = useLocation();
    return <output data-location>{location.pathname}{location.search}</output>;
}

test.each(["empty", "pending", "claimed"])("rewards %s state always leads to creation and task links are separate from claims", async (state) => {
    const adapter = apiClient.defaults.adapter;
    const locale = useLocaleStore.getState().locale;
    useLocaleStore.setState({ locale: "zh-CN" });
    const tasks = state === "empty" ? [] : [{ id: "task/a b", prompt: "待查看的作品", claimed: state === "claimed" }];
    let writes = 0;
    apiClient.defaults.adapter = async (config) => {
        if (config.method !== "get") writes++;
        const data = config.url === "/rewards" ? { account: { availableMicrocredits: 0 }, membership: {}, tasks: [], generationTasks: tasks } : { products: [] };
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => { root.render(<MemoryRouter initialEntries={["/rewards"]}><App><RewardsPage /><RouteProbe /></App></MemoryRouter>); });
        expect(host.querySelector(".rewards-task-status")?.textContent).toBe(state === "empty" ? "完成第一次创作，成功后可领取 1 积分" : state === "pending" ? "有 1 项奖励待领取" : "当前奖励已全部领取");
        expect(host.textContent).toContain("生成费用按所选模型计费");
        const create = host.querySelector<HTMLAnchorElement>(".rewards-create-link");
        expect(create?.getAttribute("href")).toBe("/create");
        expect(create?.textContent).toContain(state === "claimed" ? "继续创作" : "去创作");
        if (tasks.length) {
            const detail = host.querySelector<HTMLAnchorElement>("a.rewards-task-title");
            expect(detail?.getAttribute("href")).toBe("/tasks?taskId=task%2Fa%20b");
            await act(async () => { detail!.click(); });
            expect(host.querySelector("[data-location]")?.textContent).toBe("/tasks?taskId=task%2Fa%20b");
        }
        await act(async () => { create!.click(); });
        expect(host.querySelector("[data-location]")?.textContent).toBe("/create");
        expect(writes).toBe(0);
    } finally {
        await act(async () => { root.unmount(); });
        host.remove();
        apiClient.defaults.adapter = adapter;
        useLocaleStore.setState({ locale });
    }
});

test("returning from creation refreshes rewards and disabled task center exposes no task link", async () => {
    const adapter = apiClient.defaults.adapter;
    const locale = useLocaleStore.getState().locale;
    const features = useUserStore.getState().features;
    useLocaleStore.setState({ locale: "zh-CN" });
    useUserStore.setState({ features: { ...features, taskCenterEnabled: false } });
    let created = false;
    apiClient.defaults.adapter = async (config) => {
        const data = config.url === "/rewards" ? { account: { availableMicrocredits: 0 }, membership: {}, tasks: [], generationTasks: created ? [{ id: "new-task", prompt: "刚完成的作品", claimed: false }] : [] } : { products: [] };
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    function CreateRoute() {
        const navigate = useNavigate();
        return <button onClick={() => { created = true; navigate(-1); }}>完成并返回</button>;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => { root.render(<MemoryRouter initialEntries={["/rewards"]}><App><Routes><Route path="/rewards" element={<RewardsPage />} /><Route path="/create" element={<CreateRoute />} /></Routes></App></MemoryRouter>); });
        await act(async () => { host.querySelector<HTMLAnchorElement>(".rewards-create-link")!.click(); });
        await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
        expect(host.querySelector(".rewards-task-status")?.textContent).toBe("有 1 项奖励待领取");
        expect(host.querySelector(".rewards-task-title")?.textContent).toBe("刚完成的作品");
        expect(host.querySelector("a.rewards-task-title")).toBeNull();
    } finally {
        await act(async () => { root.unmount(); });
        host.remove();
        apiClient.defaults.adapter = adapter;
        useLocaleStore.setState({ locale });
        useUserStore.setState({ features });
    }
});

test.each(["loaded", "close-before-response", "missing"])("task URL opens the exact task outside the current list: %s", async (state) => {
    const { default: TasksPage } = await import("../src/pages/tasks");
    const adapter = apiClient.defaults.adapter;
    const locale = useLocaleStore.getState().locale;
    const features = useUserStore.getState().features;
    useLocaleStore.setState({ locale: "zh-CN" });
    useUserStore.setState({ features: { ...features, shortDramaEnabled: false } });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    apiClient.defaults.adapter = async (config) => {
        let data: unknown;
        if (config.url === "/tasks") data = [];
        else if (config.url === "/tasks/older-task/logs") data = [];
        else if (config.url === "/tasks/older-task") {
            if (state === "close-before-response") await pending;
            if (state === "missing") throw new Error("任务不存在或无权访问");
            data = { id: "older-task", type: "canvas_text", prompt: "较早的创作任务", status: "succeeded", resultJson: JSON.stringify({ mode: "text", text: "对应任务的生成结果" }), attempts: 1, createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z" };
        } else throw new Error(`Unexpected task request: ${config.url}`);
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => { root.render(<MemoryRouter initialEntries={["/tasks?status=succeeded&taskId=older-task"]}><App><TasksPage /><RouteProbe /></App></MemoryRouter>); });
        if (state !== "missing") {
            expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
            if (state === "loaded") expect(document.querySelector(".ant-drawer-body")?.textContent).toContain("对应任务的生成结果");
            await act(async () => { document.querySelector<HTMLButtonElement>(".ant-drawer-close")!.click(); });
        }
        expect(host.querySelector("[data-location]")?.textContent).toBe("/tasks?status=succeeded");
        await act(async () => { release(); await pending; });
        expect(document.querySelector(".ant-drawer-open")).toBeNull();
    } finally {
        release();
        await act(async () => { root.unmount(); });
        host.remove();
        apiClient.defaults.adapter = adapter;
        useLocaleStore.setState({ locale });
        useUserStore.setState({ features });
    }
});

test.each([
    { action: "retry", destination: "close", delay: "response", recovered: false },
    { action: "retry", destination: "switch", delay: "response", recovered: false },
    { action: "retry", destination: "leave", delay: "response", recovered: false },
    { action: "provider", destination: "switch", delay: "response", recovered: false },
    { action: "provider", destination: "switch", delay: "logs", recovered: false },
    { action: "provider", destination: "switch", delay: "response", recovered: true },
    { action: "provider", destination: "switch", delay: "logs", recovered: true },
    { action: "provider", destination: "reopen", delay: "response", recovered: true },
])("late task action respects the current drawer: %j", async ({ action, destination, delay, recovered }) => {
    const { default: TasksPage } = await import("../src/pages/tasks");
    const adapter = apiClient.defaults.adapter;
    const locale = useLocaleStore.getState().locale;
    const features = useUserStore.getState().features;
    useLocaleStore.setState({ locale: "zh-CN" });
    useUserStore.setState({ features: { ...features, shortDramaEnabled: false } });
    const taskA = { id: "task-a", type: "canvas_video", prompt: "任务 A 原始详情", status: "failed", providerRequestId: "provider-a", ...(action === "retry" ? { canRecoverMedia: true, mediaStage: "upload" } : {}), attempts: 1 };
    const taskB = { id: "task-b", type: "canvas_text", prompt: "任务 B 当前详情", status: "failed", attempts: 1 };
    let actionStarted = false;
    let actionResponded = false;
    let walletUpdates = 0;
    const updated = () => walletUpdates++;
    window.addEventListener("wallet:updated", updated);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    apiClient.defaults.adapter = async (config) => {
        let data: unknown;
        if (config.url === "/tasks") data = [];
        else if (config.url === "/tasks/task-a") data = taskA;
        else if (config.url === "/tasks/task-b") data = taskB;
        else if (config.url === "/tasks/task-b/logs") data = [{ message: "failed" }];
        else if (config.url === "/tasks/task-a/logs") {
            const actionLogs = actionResponded;
            if (actionLogs && delay === "logs") await pending;
            data = [{ message: actionLogs ? "completed" : "failed" }];
        } else if (config.url === "/tasks/task-a/recover-media" || config.url === "/tasks/task-a/query-provider") {
            actionStarted = true;
            if (delay === "response") await pending;
            actionResponded = true;
            const task = { ...taskA, prompt: "任务 A 迟到的恢复结果", status: "succeeded" };
            data = action === "retry" ? task : { recovered, task, billingSettled: true };
        } else throw new Error(`Unexpected task action request: ${config.url}`);
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    function Navigation() {
        const navigate = useNavigate();
        return <><button onClick={() => navigate("/tasks?status=failed&taskId=task-b")}>切换任务 B</button><button onClick={() => navigate("/tasks?status=failed&taskId=task-a")}>重新打开任务 A</button><button onClick={() => navigate("/settings?section=diagnostics")}>离开任务页</button><RouteProbe /></>;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => { root.render(<MemoryRouter initialEntries={["/tasks?status=failed&taskId=task-a"]}><App><Routes><Route path="/tasks" element={<><TasksPage /><Navigation /></>} /><Route path="/settings" element={<RouteProbe />} /></Routes></App></MemoryRouter>); });
        const actionButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".ant-drawer-body button")).find((button) => button.textContent?.includes(action === "retry" ? "重试保存" : "手动查询任务"));
        expect(actionButton).toBeDefined();
        await act(async () => { actionButton!.click(); });
        expect(actionStarted).toBe(true);
        if (destination === "leave") {
            await act(async () => { Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "离开任务页")!.click(); });
        } else if (destination === "switch") {
            await act(async () => { Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "切换任务 B")!.click(); });
        } else {
            await act(async () => { document.querySelector<HTMLButtonElement>(".ant-drawer-close")!.click(); });
            if (destination === "reopen") await act(async () => { Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "重新打开任务 A")!.click(); });
        }
        await act(async () => { release(); await pending; });
        if (destination === "leave") {
            expect(host.querySelector("[data-location]")?.textContent).toBe("/settings?section=diagnostics");
            expect(document.querySelector(".ant-drawer-open")).toBeNull();
            return;
        }
        expect(host.querySelector("[data-location]")?.textContent).toBe(`/tasks?status=${action === "retry" ? "active" : "failed"}${destination === "close" ? "" : `&taskId=task-${destination === "switch" ? "b" : "a"}`}`);
        if (destination === "close") expect(document.querySelector(".ant-drawer-open")).toBeNull();
        else {
            const drawer = document.querySelector(".ant-drawer-body")?.textContent;
            expect(drawer).toContain(destination === "switch" ? taskB.prompt : taskA.prompt);
            expect(drawer).not.toContain("任务 A 迟到的恢复结果");
            expect(drawer).not.toContain("stage=completed");
        }
        if (action === "provider" && recovered) expect(walletUpdates).toBe(1);
    } finally {
        release();
        await act(async () => { root.unmount(); });
        host.remove();
        apiClient.defaults.adapter = adapter;
        useLocaleStore.setState({ locale });
        useUserStore.setState({ features });
        window.removeEventListener("wallet:updated", updated);
    }
});

test.each(["granted", "already-claimed", "failed"])("task reward reflects server state and handles %s claims", async (outcome) => {
    const adapter = apiClient.defaults.adapter;
    const locale = useLocaleStore.getState().locale;
    useLocaleStore.setState({ locale: "zh-CN" });
    let claimed = false;
    let claimRequests = 0;
    let walletUpdates = 0;
    let releaseClaim!: () => void;
    const pendingClaim = new Promise<void>((resolve) => { releaseClaim = resolve; });
    const updated = () => walletUpdates++;
    window.addEventListener("wallet:updated", updated);
    apiClient.defaults.adapter = async (config) => {
        let data: unknown;
        if (config.url === "/rewards") {
            data = { account: { userId: "owner", availableMicrocredits: claimed ? 1_000_000 : 0 }, membership: { userId: "owner", plan: "", startsAt: "", expiresAt: "" }, tasks: [], shareRewardMicrocredits: 2_000_000, shareClaimedToday: false, generationTasks: [{ id: "previous", prompt: "之前已领取的任务", claimed: true }, { id: "available", prompt: "服务端完成的任务", claimed }] };
        } else if (config.url === "/payments/products") {
            data = { products: [] };
        } else if (config.url === "/tasks") {
            // 普通任务中心的 succeeded 不能自行成为奖励领取凭据。
            data = [{ id: "unverified", prompt: "未验证的任务", status: "succeeded", updatedAt: "2026-10-21T00:00:00Z" }];
        } else if (config.url === "/rewards/tasks/available/claim") {
            claimRequests++;
            await pendingClaim;
            if (outcome === "failed") throw new Error("领取失败");
            claimed = true;
            data = { account: { userId: "owner", availableMicrocredits: 1_000_000 }, granted: outcome === "granted" };
        } else {
            throw new Error(`Unexpected request: ${config.method} ${config.url}`);
        }
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = async (key: string) => {
        await act(async () => {
            root.render(<MemoryRouter><App><RewardsPage key={key} /></App></MemoryRouter>);
        });
    };
    const taskButton = (title: string) => Array.from(host.querySelectorAll(".rewards-task-row")).find((row) => row.textContent?.includes(title))?.querySelector<HTMLButtonElement>("button");
    try {
        await render("initial");
        expect(taskButton("之前已领取的任务")?.disabled).toBe(true);
        expect(taskButton("之前已领取的任务")?.textContent).toContain("已领取");
        expect(host.textContent).not.toContain("未验证的任务");
        const button = taskButton("服务端完成的任务")!;
        expect(button.disabled).toBe(false);
        await act(async () => { button.click(); button.click(); });
        expect(claimRequests).toBe(1);
        await act(async () => { releaseClaim(); await pendingClaim; });
        expect(taskButton("服务端完成的任务")?.disabled).toBe(outcome !== "failed");
        expect(taskButton("服务端完成的任务")?.textContent?.replace(/\s/g, "")).toBe(outcome === "failed" ? "领取1积分" : "已领取");
        expect(walletUpdates).toBe(outcome === "failed" ? 0 : 1);
        expect(host.querySelector(".rewards-task-status")?.textContent).toBe(outcome === "failed" ? "有 1 项奖励待领取" : "当前奖励已全部领取");
        if (outcome !== "failed") expect(host.querySelector(".rewards-balance strong")?.textContent).toBe("1 积分");
        await render("reload");
        expect(taskButton("服务端完成的任务")?.disabled).toBe(outcome !== "failed");
    } finally {
        releaseClaim();
        await act(async () => { root.unmount(); });
        host.remove();
        apiClient.defaults.adapter = adapter;
        useLocaleStore.setState({ locale });
        window.removeEventListener("wallet:updated", updated);
    }
});
