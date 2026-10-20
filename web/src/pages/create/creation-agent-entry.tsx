import { useRef, useState } from "react";
import { App, Button } from "antd";
import { ArrowUpRight, FolderOpen, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { hasRemoteUserDataSyncSession, loadCanvasProjectForEditing, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { ApiError } from "@/services/api/request";

/** Agent 依赖真实画布 ID，先完成服务端保存，再进入同一个画布 Agent。 */
export function CreationAgentEntry({ canvasId }: { canvasId?: string }) {
    const { text } = useLocaleText();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const start = async () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        const userId = useUserStore.getState().user?.id;
        try {
            if (!userId || !hasRemoteUserDataSyncSession()) throw new Error(text("登录或同步会话尚未就绪，请稍后重试。", "Your session is not ready. Try again shortly."));
            if (!canvasId) throw new Error(text("项目正在准备中，请稍后重试。", "Your project is being prepared. Try again shortly."));
            if (!hydrated) throw new Error(text("画布还在恢复中，请稍后重试。", "Canvas is still loading. Try again shortly."));
            const project = await loadCanvasProjectForEditing(canvasId);
            if (useUserStore.getState().user?.id !== userId) return;
            if (!project) throw new Error(text("项目已不存在，请重新选择。", "Project no longer exists. Choose another."));
            await saveRemoteUserDataNow(canvasId);
            if (useUserStore.getState().user?.id !== userId) return;
            navigate(`/canvas/${encodeURIComponent(canvasId)}?agent=1`);
        } catch (cause) {
            if (useUserStore.getState().user?.id === userId) {
                const detail = cause instanceof ApiError ? localizedErrorMessage(cause, "启动失败，请重试。", "Could not start Agent") : cause instanceof Error ? cause.message : text("启动失败，请重试。", "Could not start Agent");
                setError(detail);
                message.error(detail);
            }
        } finally { lock.current = false; setBusy(false); }
    };
    return <section className="creation-agent-entry" aria-label={text("画布 Agent 模式", "Canvas Agent mode")}>
        <div className="creation-agent-orb" aria-hidden><FluidOrb size={88} /></div>
        <div className="creation-agent-copy"><span className="creation-agent-eyebrow">CANVAS AGENT</span><h2>{text("不止回答，把想法落到画布上", "Turn your ideas into a canvas")}</h2><p>{text("使用画布里的同一个 Agent，结合素材、技能与创作上下文协作。生成与修改仍需经过原有审批和额度检查。", "Work with Agent across your assets, skills, and creative context. Generation and edits still follow approval and quota checks.")}</p></div>
        <div className="creation-agent-actions">
            <Button type="primary" icon={<Sparkles />} loading={busy} disabled={!hydrated || !canvasId} onClick={() => void start()}>
                {text("进入项目，与 Agent 创作", "Open project with Agent")}<ArrowUpRight />
            </Button>
            <Button icon={<FolderOpen />} disabled={busy} onClick={() => navigate("/projects")}>{text("打开我的项目", "Open my projects")}</Button>
        </div>
        {error ? <p className="creation-agent-error" role="alert">{error}</p> : null}
    </section>;
}
