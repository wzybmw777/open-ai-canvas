import type { ReactNode } from "react";
import { lazy, Suspense, useLayoutEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "dayjs/locale/en";

import { AuthSessionHydrator } from "@/components/auth/auth-session-hydrator";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme } from "@/lib/skin-themes";
import { appQueryClient } from "@/lib/query-client";
import { isIsolatedDirectorRepro } from "@/lib/dev-repro";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { applyAppearanceMetadata, DEFAULT_PUBLIC_APPEARANCE, useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { useLocaleStore, useLocaleText } from "@/lib/i18n";

const ClientRootInit = lazy(() => import("@/components/layout/client-root-init").then((module) => ({ default: module.ClientRootInit })));

function ClientRootBoundary({ children }: { children: ReactNode }) {
    const authenticated = useUserStore((state) => Boolean(state.user));
    const { text } = useLocaleText();
    if (!authenticated) return children;
    return <Suspense fallback={<FullScreenLoader label={text("正在准备创作环境", "Preparing your workspace")} detail={text("连接本地能力与模型配置", "Connecting models and tools")} />}><ClientRootInit>{children}</ClientRootInit></Suspense>;
}

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useActiveTheme();
    const dark = theme === "dark";
    const appearance = useAppearanceStore((state) => state.appearance);
    const locale = useLocaleStore((state) => state.locale);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
        applySkinTheme(appearance.activeSkin, theme);
        applyAppearanceMetadata(locale === "en-US" ? {
            ...appearance,
            seoDescription: appearance.seoDescription === DEFAULT_PUBLIC_APPEARANCE.seoDescription ? "An AI workspace for film and short drama creation." : appearance.seoDescription,
        } : appearance);
        document.documentElement.lang = locale;
        dayjs.locale(locale === "en-US" ? "en" : "zh-cn");
    }, [appearance, dark, locale, theme]);

    // DEV 复现台必须是同源本地确定性场景：AuthSessionHydrator 会打 /api/auth/session，
    // ClientRootInit 会打 /api/model-catalog，没有后端时产生真实 502，与导演台无关却会污染判据。
    // 与启动入口共用精确路径边界；生产构建中 import.meta.env.DEV 为 false，始终不启用隔离。
    const isolateDevRepro = typeof window !== "undefined" && isIsolatedDirectorRepro(import.meta.env.DEV, window.location.pathname);

    return (
        <ConfigProvider locale={locale === "en-US" ? enUS : zhCN} theme={getAntThemeConfig(dark, appearance.activeSkin)} wave={{ disabled: true }}>
            <App message={{ duration: 3, maxCount: 3 }} notification={{ duration: 4.5, maxCount: 3, placement: "topRight" }}>
                <QueryClientProvider client={appQueryClient}>
                    {isolateDevRepro ? (
                        children
                    ) : (
                        <AuthSessionHydrator>
                            <ClientRootBoundary>{children}</ClientRootBoundary>
                        </AuthSessionHydrator>
                    )}
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
