import { useEffect, useState, useSyncExternalStore } from "react";
import { CircleCheck, Info, RefreshCw, X } from "lucide-react";
import { getPublicSystemUpdateStatus, getSystemReadiness } from "@/services/api/system-update";
import { createSystemUpdateMonitor } from "@/services/system-update-monitor";
import "./system-update-notice.css";

export function SystemUpdateNotice() {
    const [monitor] = useState(() => createSystemUpdateMonitor(getPublicSystemUpdateStatus, getSystemReadiness));
    const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getSnapshot);
    useEffect(() => {
        const stop = monitor.start();
        const refresh = () => {
            if (document.visibilityState === "visible") void monitor.check();
        };
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            stop();
            window.removeEventListener("focus", refresh);
            window.removeEventListener("online", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [monitor]);
    if (state === "idle") return null;
    const restored = state === "restored";
    return (
        <aside className="system-update-notice" role="status" aria-live="polite" aria-atomic="true" data-canvas-no-zoom>
            {restored ? <CircleCheck size={20} aria-hidden /> : <Info size={20} aria-hidden />}
            <div className="system-update-notice__message">
                <strong>{restored ? "系统服务已恢复" : state === "updating" ? "系统更新中，请稍候" : "服务暂时不可用，正在自动重连"}</strong>
                <span>{restored ? "请先保存当前编辑内容，再刷新页面继续使用。" : "当前页面将保留，服务恢复后会提醒你。"}</span>
            </div>
            {restored && <>
                <button type="button" onClick={() => window.location.reload()}><RefreshCw size={14} aria-hidden />刷新页面</button>
                <button className="system-update-notice__dismiss" type="button" aria-label="稍后刷新" onClick={monitor.dismiss}><X size={16} aria-hidden /></button>
            </>}
        </aside>
    );
}
