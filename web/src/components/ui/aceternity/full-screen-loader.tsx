import { useEffect, useState } from "react";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { cn } from "@/lib/utils";
import { useLocaleText } from "@/lib/i18n";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

export function FullScreenLoader({ label, detail, className }: FullScreenLoaderProps) {
    const { text } = useLocaleText();
    const adminRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
    const visibleLabel = label || (adminRoute ? "正在恢复工作区" : text("正在恢复工作区", "Restoring workspace"));
    const visibleDetail = detail || (adminRoute ? "同步账号、模型和项目数据" : text("同步账号、模型和项目数据", "Syncing account, models, and projects"));
    return (
        <div
            data-full-screen-loader
            role="status"
            aria-live="polite"
            aria-label={`${visibleLabel}, ${visibleDetail}`}
            className={cn("full-screen-loader", className)}
        >
            <div className="full-screen-loader-scene" aria-hidden="true">
                <span className="full-screen-loader-guide is-horizontal" />
                <span className="full-screen-loader-guide is-vertical" />
                <span className="full-screen-loader-frame is-left"><i /><i /><i /></span>
                <span className="full-screen-loader-frame is-right"><i /><i /><i /></span>
                <span className="full-screen-loader-script"><i /><i /><i /><b /></span>
                <span className="full-screen-loader-timeline"><i /><i /><i /><i /><b /></span>
                <span className="full-screen-loader-orbit" />
                <BrandLogoFrame className="full-screen-loader-logo" logoClassName="full-screen-loader-logo-image" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} />
            </div>
            <div className="full-screen-loader-copy"><strong>{visibleLabel}</strong><span>{visibleDetail}</span><LoadingSignal /></div>
        </div>
    );
}

export function WorkspaceRouteLoader({ label }: { label?: string }) {
    const [visible, setVisible] = useState(false);
    const { text } = useLocaleText();
    const visibleLabel = label || (typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? "正在打开页面" : text("正在打开页面", "Opening page"));

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={visibleLabel}>
            <div className="workspace-route-loader-content">
                <span className="workspace-route-loader-mark"><BrandLogoFrame className="workspace-route-loader-logo" logoClassName="size-4" alt="" fallback={<span className="full-screen-loader-logo-fallback" />} /></span>
                <LoadingSignal />
                <span>{visibleLabel}</span>
            </div>
        </section>
    );
}

function LoadingSignal() {
    return <span className="loading-signal" aria-hidden="true"><i /><i /><i /></span>;
}
