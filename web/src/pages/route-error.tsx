import { Button } from "antd";
import { Home, RefreshCw } from "lucide-react";
import { useLocation, useNavigate, useRouteError } from "react-router";

import { WorkspaceSignalIcon } from "@/components/ui/aceternity/workspace-signal-icon";
import { reloadAfterChunkFailure } from "@/lib/chunk-recovery";
import { useLocaleText } from "@/lib/i18n";

export default function RouteErrorPage() {
    const error = useRouteError();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { locale, text } = useLocaleText();
    const adminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
    const message = error instanceof Error ? (adminRoute || locale !== "en-US" || !/[\u3400-\u9fff]/.test(error.message) ? error.message : "The page could not be loaded.") : adminRoute ? "页面暂时无法显示" : text("页面暂时无法显示", "The page could not be displayed");

    return (
        <main className="app-workspace-page grid h-dvh place-items-center px-6 text-foreground">
            <section className="w-full max-w-md text-center">
                <WorkspaceSignalIcon variant="error" size="lg" className="mx-auto" />
                <p className="text-xs font-medium text-muted-foreground">{adminRoute ? "页面运行异常" : text("页面运行异常", "Page error")}</p>
                <h1 className="mt-3 text-2xl font-semibold">{adminRoute ? "当前页面没有正常加载" : text("当前页面没有正常加载", "This page did not load")}</h1>
                <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">{message}</p>
                <div className="mt-6 flex justify-center gap-3">
                    <Button icon={<RefreshCw className="size-4" />} onClick={reloadAfterChunkFailure}>{adminRoute ? "重新加载" : text("重新加载", "Reload")}</Button>
                    <Button type="primary" icon={<Home className="size-4" />} onClick={() => navigate("/")}>{adminRoute ? "返回主页" : text("返回主页", "Back to home")}</Button>
                </div>
            </section>
        </main>
    );
}
