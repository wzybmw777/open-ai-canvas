import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as api from "../src/services/api/user-data";
import * as sync from "../src/services/user-data-sync";
import { ensureDefaultCreationProject } from "../src/services/creation-project";
import * as canvasStore from "../src/stores/canvas/use-canvas-store";
import { useCanvasStore } from "../src/stores/canvas/use-canvas-store";
import { continueCreationConversationOnCanvas } from "../src/services/creation-canvas-conversation";
import { useUserStore } from "../src/stores/use-user-store";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";

let canvasState: ReturnType<typeof useCanvasStore.getState>;
let userState: ReturnType<typeof useUserStore.getState>;
let previousScope: string;
const restorers: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
    previousScope = getActiveUserScope();
    setActiveUserScope("creation-owner");
    canvasState = { ...useCanvasStore.getState(), hydrated: true, projects: [] };
    userState = { ...useUserStore.getState(), user: { id: "creation-owner" } as NonNullable<ReturnType<typeof useUserStore.getState>["user"]> };
    restorers.push(spyOn(useCanvasStore, "getState").mockImplementation(() => canvasState));
    restorers.push(spyOn(useUserStore, "getState").mockImplementation(() => userState));
    restorers.push(spyOn(sync, "hasRemoteUserDataSyncSession").mockReturnValue(true));
});

afterEach(() => {
    restorers.reverse().forEach((spy) => spy.mockRestore());
    restorers.length = 0;
    setActiveUserScope(previousScope);
});

test("a cold cache reuses the default canvas on the server", async () => {
    restorers.push(spyOn(api, "listRemoteCanvasProjects").mockResolvedValue({ projects: [{ id: "existing-canvas", title: "默认项目", createdAt: "", updatedAt: "" }] }));
    expect(await ensureDefaultCreationProject()).toBe("existing-canvas");
    expect(canvasState.projects).toHaveLength(0);
});

test("concurrent first entry returns the same saved canvas", async () => {
    restorers.push(spyOn(api, "listRemoteCanvasProjects").mockResolvedValue({ projects: [] }));
    let nextId = 0;
    restorers.push(spyOn(sync, "createCanvasProjectWithRemoteSync").mockImplementation(async () => ({ id: `new-${++nextId}` })));
    expect(await Promise.all([ensureDefaultCreationProject(), ensureDefaultCreationProject()])).toEqual(["new-1", "new-1"]);
});

test("failed cloud creation stays an error and retries the same local canvas", async () => {
    restorers.push(spyOn(api, "listRemoteCanvasProjects").mockResolvedValue({ projects: [] }));
    restorers.push(spyOn(sync, "createCanvasProjectWithRemoteSync").mockImplementation(async () => {
        canvasState.projects = [{ id: "pending-canvas", title: "默认项目", revision: 0 } as typeof canvasState.projects[number]];
        return { id: "pending-canvas", syncError: new Error("offline") };
    }));
    restorers.push(spyOn(sync, "saveRemoteUserDataNow").mockResolvedValue(undefined));
    await expect(ensureDefaultCreationProject()).rejects.toThrow("offline");
    expect(await ensureDefaultCreationProject()).toBe("pending-canvas");
});

test("an account switch during loading cannot create a canvas in the new account", async () => {
    restorers.push(spyOn(api, "listRemoteCanvasProjects").mockImplementation(async () => {
        setActiveUserScope("another-owner");
        userState = { ...userState, user: { ...userState.user!, id: "another-owner" } };
        return { projects: [] };
    }));
    await expect(ensureDefaultCreationProject()).rejects.toThrow("账号已切换");
    expect(canvasState.projects).toHaveLength(0);
});

test("initialization waits for the remote sync session before creating the default", async () => {
    restorers.push(spyOn(sync, "hasRemoteUserDataSyncSession").mockReturnValue(false));
    restorers.push(spyOn(api, "listRemoteCanvasProjects").mockResolvedValue({ projects: [] }));
    restorers.push(spyOn(sync, "createCanvasProjectWithRemoteSync").mockResolvedValue({ id: "only-local" }));
    await expect(ensureDefaultCreationProject()).rejects.toThrow("尚未就绪");
});

test("a remotely deleted synced canvas cannot become the default again from a stale local cache", async () => {
    canvasState.projects = [{ id: "deleted-canvas", title: "默认项目", revision: 3 } as typeof canvasState.projects[number]];
    restorers.push(spyOn(api, "listRemoteCanvasProjects").mockResolvedValue({ projects: [] }));
    restorers.push(spyOn(sync, "saveRemoteUserDataNow").mockResolvedValue(undefined));
    restorers.push(spyOn(sync, "createCanvasProjectWithRemoteSync").mockResolvedValue({ id: "replacement-canvas" }));
    expect(await ensureDefaultCreationProject()).toBe("replacement-canvas");
});

test("continuing on the selected canvas merges conversation messages and preserves its Agent work", async () => {
    const canvas = {
        id: "selected-canvas", title: "默认项目", chatSessions: [
            { id: "agent-session", messages: [{ id: "agent-work", role: "assistant", text: "existing work" }] },
            { id: "creation:conversation", messages: [{ id: "creation:conversation:first", role: "user", text: "old text" }, { id: "canvas-reply", role: "assistant", text: "canvas reply" }] },
        ],
    } as unknown as typeof canvasState.projects[number];
    restorers.push(spyOn(sync, "loadCanvasProjectForEditing").mockResolvedValue(canvas));
    restorers.push(spyOn(sync, "saveRemoteUserDataNow").mockResolvedValue(undefined));
    restorers.push(spyOn(canvasStore, "flushCanvasStorePersistence").mockResolvedValue(undefined));
    let patch: Partial<typeof canvas> | undefined;
    canvasState.updateProject = (id, updates) => { expect(id).toBe(canvas.id); patch = updates; };
    const result = await continueCreationConversationOnCanvas({
        id: "conversation", title: "Current idea", updatedAt: "2026-10-20", canvasId: canvas.id,
        messages: [{ id: "first", role: "user", content: "updated prompt", createdAt: "2026-10-20" }, { id: "second", role: "assistant", content: "new result", createdAt: "2026-10-20", status: "done" }],
    });
    expect(result).toEqual({ id: canvas.id, sessionId: "creation:conversation", syncError: undefined });
    expect(patch?.activeChatId).toBe("creation:conversation");
    expect(patch?.chatSessions?.[0]).toBe(canvas.chatSessions![0]);
    expect(patch?.chatSessions?.[1].messages.map(({ id, text }) => ({ id, text }))).toEqual([
        { id: "creation:conversation:first", text: "updated prompt" },
        { id: "canvas-reply", text: "canvas reply" },
        { id: "creation:conversation:second", text: "new result" },
    ]);
});
