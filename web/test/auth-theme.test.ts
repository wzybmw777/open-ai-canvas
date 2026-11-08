import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { DEFAULT_CLASSIC_SKIN, applySkinTheme, duplicateSkinDefinition, skinCSSVariables } from "../src/lib/skin-themes";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("authentication follows the application theme", () => {
    test("classic login surfaces have distinct light and dark palettes", () => {
        const css = source("styles/globals.css").replace(/\r\n/g, "\n");
        const darkStart = css.indexOf(".dark {\n    --background:");
        expect(darkStart).toBeGreaterThan(0);
        for (const [mode, background, panel, card] of [
            ["light", "#ffffff", "#f7f7f7", "#ffffff"],
            ["dark", "#08090c", "#0b0c10", "#121318"],
        ] as const) {
            const modeCSS = mode === "dark" ? css.slice(darkStart) : css.slice(0, darkStart);
            expect(modeCSS).toContain(`--auth-page-bg: ${background};`);
            expect(modeCSS).toContain(`--auth-panel-bg: ${panel};`);
            expect(modeCSS).toContain(`--auth-card-bg: ${card};`);
            const properties = new Map<string, string>([["--auth-page-bg", "#123456"]]);
            const document = { documentElement: { dataset: {}, style: { removeProperty: (key: string) => properties.delete(key), setProperty: (key: string, value: string) => properties.set(key, value) } } };
            applySkinTheme(DEFAULT_CLASSIC_SKIN, mode, document as unknown as Document);
            for (const key of ["--auth-page-bg", "--auth-panel-bg", "--auth-card-bg", "--auth-accent", "--auth-muted"]) {
                expect(properties.has(key)).toBe(false);
            }
        }
    });

    test("auth inherits the global Ant Design provider instead of forcing dark controls", () => {
        const scene = source("pages/auth/auth-scene.tsx");
        expect(scene).not.toContain("ConfigProvider");
        expect(scene).not.toContain("getAntThemeConfig");
        expect(scene).not.toContain("auth-card-dark");
        expect(scene.match(/<main className="([^"]+)"/)?.[1]).not.toContain("text-white");
        expect(scene).toContain("auth-scene-hero");
        expect(scene).toContain("<BrandLogo theme={theme}");
        expect(source("components/layout/app-providers.tsx")).toContain("getAntThemeConfig(dark, appearance.activeSkin)");
    });

    test("form links, tabs and notices do not assume white text", () => {
        for (const form of ["auth-login-form", "auth-recovery-form", "auth-form-parts", "auth-panel", "auth-dialog", "verification-fields"]) {
            const code = source(`components/auth/${form}.tsx`);
            expect(code).not.toMatch(/(?:text|border|bg)-white/);
            expect(code).not.toMatch(/text-(?:blue|amber)-[123]00/);
        }
        // 提示条统一走主题感知的 auth-scene-notice，注册与找回密码都经 AuthNotice 渲染。
        expect(source("components/auth/auth-form-parts.tsx")).toContain("auth-scene-notice");
        expect(source("components/auth/auth-login-form.tsx")).toContain("<AuthNotice");
        expect(source("components/auth/auth-recovery-form.tsx")).toContain("<AuthNotice");
    });

    test("focus and autofill keep theme-aware foregrounds and visible focus", () => {
        const css = source("styles/globals.css");
        const panel = source("components/auth/auth-panel.css");
        expect(css).not.toContain(".auth-card-dark");
        expect(panel).toContain(".auth-panel input:-webkit-autofill");
        expect(panel).toContain("-webkit-text-fill-color: var(--foreground)");
        expect(panel).toContain("box-shadow: 0 0 0 1000px var(--auth-card-bg) inset");
        expect(panel).toContain(".auth-tab:focus-visible");
        expect(panel).toContain(".auth-form-link:focus-visible");
        // 选中只改颜色与下划线，不改字重。
        expect(panel).not.toMatch(/\.auth-tab\[aria-selected="true"\][^}]*font-weight/);
    });

    test("custom auth palettes are preserved per mode", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.light.authPanel = "#f6ebe3";
        skin.tokens.light.authCard = "#fffdf9";
        skin.tokens.dark.authPanel = "#21120e";
        skin.tokens.dark.authCard = "#361f17";
        expect(skinCSSVariables(skin, "light")["--auth-panel-bg"]).toBe("#f6ebe3");
        expect(skinCSSVariables(skin, "light")["--auth-card-bg"]).toBe("#fffdf9");
        expect(skinCSSVariables(skin, "dark")["--auth-panel-bg"]).toBe("#21120e");
        expect(skinCSSVariables(skin, "dark")["--auth-card-bg"]).toBe("#361f17");
    });
});
