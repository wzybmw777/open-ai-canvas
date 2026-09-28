import { HardDrive } from "lucide-react";
import { Link } from "react-router";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useLocaleText } from "@/lib/i18n";

function StorageGlyph() {
    return (
        <span className="app-workspace-sidebar-storage-icon" aria-hidden="true">
            <HardDrive strokeWidth={1.75} />
        </span>
    );
}

export function WorkspaceSidebarStorageMeter({ collapsed }: { collapsed: boolean }) {
    const { text } = useLocaleText();
    const query = useAccountFileStorageUsage();
    const meter = accountStorageMeter(query.data);
    const usedText = query.data ? text(`已用 ${meter.usedLabel}`, `Used ${meter.usedLabel}`) : query.isError ? text("容量暂不可用", "Storage unavailable") : text("正在统计容量", "Calculating storage");
    const remainingText = query.data ? (meter.full ? text("容量已满", "Storage full") : text(`剩余 ${meter.remainingLabel}`, `${meter.remainingLabel} remaining`)) : "";
    const totalText = query.data ? text(`共 ${meter.totalLabel}`, `of ${meter.totalLabel}`) : "";
    const summary = query.data ? `${usedText}，${remainingText}，${totalText}` : usedText;

    const track = (
        <span
            className="app-workspace-sidebar-storage-track"
            role="progressbar"
            aria-label={text("账号文件容量使用进度", "Account storage usage")}
            aria-valuemin={0}
            aria-valuemax={query.data?.totalBytes ?? 0}
            aria-valuenow={query.data ? Math.min(query.data.usedBytes, query.data.totalBytes) : 0}
            aria-valuetext={summary}
        >
            <span style={{ width: `${meter.percent}%` }} />
        </span>
    );

    if (query.isError && !query.data) {
        return (
            <div className={cn("app-workspace-sidebar-storage is-error", collapsed && "is-collapsed")}>
                {collapsed ? (
                    <button type="button" title={text("容量统计暂时不可用，点击重试", "Storage unavailable. Retry")} aria-label={text("重试加载账号容量", "Retry account storage")} onClick={() => void query.refetch()}>
                        <StorageGlyph />
                    </button>
                ) : (
                    <>
                        <StorageGlyph />
                        <span>{text("容量暂不可用", "Storage unavailable")}</span>
                        <button type="button" onClick={() => void query.refetch()}>
                            {text("重试", "Retry")}
                        </button>
                    </>
                )}
            </div>
        );
    }

    return (
        <Link
            to="/assets"
            className={cn(
                "app-workspace-sidebar-storage",
                collapsed && "is-collapsed",
                meter.tone === "warn" && "is-warn",
                meter.tone === "critical" && "is-critical",
                query.data?.usedBytes ? "has-usage" : null,
                query.isPending && !query.data && "is-pending",
            )}
            title={text(`${summary}。包含素材文件和 Agent 会话附件`, `${summary}. Includes assets and Agent attachments`)}
            aria-label={text(`账号容量，${summary}`, `Account storage, ${summary}`)}
            aria-busy={query.isPending && !query.data}
            onFocus={() => preloadWorkspaceRoute("/assets")}
            onPointerEnter={() => preloadWorkspaceRoute("/assets")}
        >
            <StorageGlyph />
            {collapsed ? (
                track
            ) : (
                <span className="app-workspace-sidebar-storage-body">
                    <span className="app-workspace-sidebar-storage-copy">
                        <span className="app-workspace-sidebar-storage-meta">
                            <span className="app-workspace-sidebar-storage-used">{usedText}</span>
                            {totalText ? <span className="app-workspace-sidebar-storage-total">{totalText}</span> : null}
                        </span>
                    </span>
                    <span className="app-workspace-sidebar-storage-foot">
                        {track}
                        {remainingText ? <span className="app-workspace-sidebar-storage-remain">{remainingText}</span> : null}
                    </span>
                </span>
            )}
        </Link>
    );
}
