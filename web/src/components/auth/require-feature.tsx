import { useEffect, useState, type ReactNode } from "react";
import { Button } from "antd";
import { useLocation, useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled";

const featureNames: Record<FeatureKey, string> = {
    shortDramaEnabled: "短剧创作",
    taskCenterEnabled: "任务中心",
    creditsEnabled: "积分中心",
    frontendModelsEnabled: "前台模型",
    pluginCenterEnabled: "插件中心",
};
const englishFeatureNames: Record<FeatureKey, string> = {
    shortDramaEnabled: "Short drama creation",
    taskCenterEnabled: "Task center",
    creditsEnabled: "Credits",
    frontendModelsEnabled: "Models",
    pluginCenterEnabled: "Plugin center",
};

export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { locale, text } = useLocaleText();
    const adminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
    const label = !adminRoute && locale === "en-US" ? englishFeatureNames[feature] : featureNames[feature];
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    const [checking, setChecking] = useState(() => !useUserStore.getState().features[feature]);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        setError("");
        refreshFeatureAvailability()
            .catch((reason) => {
                if (!cancelled) setError(adminRoute && reason instanceof Error ? reason.message : localizedErrorMessage(reason, "读取功能开放状态失败", "Could not check feature availability", adminRoute ? "zh-CN" : locale));
            })
            .finally(() => {
                if (!cancelled) setChecking(false);
            });
        return () => {
            cancelled = true;
        };
    }, [adminRoute, feature, locale, user?.id]);

    if (checking) return <WorkspacePage><WorkspaceLoadingState label={adminRoute ? "正在确认功能状态" : text("正在确认功能状态", "Checking availability")} detail={label} rows={3} /></WorkspacePage>;
    if (error) return <WorkspacePage><WorkspaceErrorState title={adminRoute ? "无法确认功能状态" : text("无法确认功能状态", "Could not check availability")} description={error} actionLabel={adminRoute ? "返回创作台" : text("返回创作台", "Back to workspace")} onRetry={() => navigate("/", { replace: true })} /></WorkspacePage>;
    if (!features[feature]) {
        const isAdminFeature = adminRoute || feature === "frontendModelsEnabled";
        const backPath = isAdminFeature ? "/admin" : "/";
        const backLabel = isAdminFeature ? "返回管理后台" : text("返回创作台", "Back to workspace");

        return (
            <WorkspacePage>
                <WorkspaceState icon="empty" title={adminRoute ? `${label}暂未开放` : locale === "en-US" ? `${label} is unavailable` : `${label}暂未开放`} description={adminRoute ? "当前功能已由平台管理员关闭。" : text("当前功能已由平台管理员关闭。", "This feature is currently disabled by the platform administrator.")} action={<Button type="primary" onClick={() => navigate(backPath, { replace: true })}>{backLabel}</Button>} />
            </WorkspacePage>
        );
    }
    return children;
}
