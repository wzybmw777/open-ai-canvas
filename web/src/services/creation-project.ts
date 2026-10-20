import { getActiveUserScope } from "@/lib/user-scope";
import { listRemoteCanvasProjects } from "@/services/api/user-data";
import { createCanvasProjectWithRemoteSync, hasRemoteUserDataSyncSession, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";

const pendingDefaults = new Map<string, Promise<string>>();

/** The creation page and canvas library share one real canvas, including its server ID. */
export function ensureDefaultCreationProject(): Promise<string> {
    const userId = useUserStore.getState().user?.id;
    const scope = getActiveUserScope();
    if (!userId || !useCanvasStore.getState().hydrated || !hasRemoteUserDataSyncSession()) return Promise.reject(new Error("创作空间尚未就绪，请稍后重试"));
    const pending = pendingDefaults.get(scope);
    if (pending) return pending;
    const assertScope = () => {
        if (scope !== getActiveUserScope() || useUserStore.getState().user?.id !== userId) throw new DOMException("账号已切换", "AbortError");
    };
    const prepare = async () => {
        assertScope();
        // Read the server before creating: a cold browser cache must not create another default.
        const { projects } = await listRemoteCanvasProjects();
        assertScope();
        const existing = projects.find((project) => project.title === "默认项目");
        if (existing) return existing.id;
        const local = useCanvasStore.getState().projects.find((project) => project.title === "默认项目" && project.revision === 0);
        if (local) {
            await saveRemoteUserDataNow(local.id);
            assertScope();
            return local.id;
        }
        const created = await createCanvasProjectWithRemoteSync("默认项目");
        assertScope();
        if (created.syncError) throw created.syncError;
        return created.id;
    };
    // Serialize first use across tabs as well as React mounts when Web Locks is available.
    const result = (typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request(`yingce:default-creation-project:${scope}`, prepare)
        : prepare()).finally(() => { if (pendingDefaults.get(scope) === result) pendingDefaults.delete(scope); });
    pendingDefaults.set(scope, result);
    return result;
}
