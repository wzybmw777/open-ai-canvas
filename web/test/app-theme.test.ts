import { describe, expect, test } from "bun:test";

import { getAntThemeConfig, getWorkspaceAntThemeConfig } from "../src/lib/app-theme";
import { DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition } from "../src/lib/skin-themes";
import { getIsolatedAdminAntTheme } from "../src/pages/admin/theme/admin-ant-theme";

describe("shared action colors and focus feedback", () => {
    for (const dark of [false, true]) {
        test(`classic product and isolated admin keep readable action palettes in ${dark ? "dark" : "light"} mode`, () => {
            const product = getAntThemeConfig(dark, DEFAULT_CLASSIC_SKIN);
            const admin = getIsolatedAdminAntTheme(dark, DEFAULT_CLASSIC_SKIN);
            expect(product.components?.Button?.colorPrimary).toBe(dark ? "#f5f5f5" : "#171717");
            expect(admin.components?.Button?.colorPrimary).toBe(dark ? "#f0b90b" : "#2f5ea8");
            expect(admin.components?.Button?.primaryColor).toBe(dark ? "#181a20" : "#ffffff");
        });

        test(`custom primary action states reach product and admin in ${dark ? "dark" : "light"} mode`, () => {
            const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
            Object.assign(skin.tokens[dark ? "dark" : "light"], {
                primary: "#123456",
                primaryHover: "#234567",
                primaryActive: "#345678",
                primaryForeground: "#abcdef",
            });
            for (const theme of [getAntThemeConfig(dark, skin), getIsolatedAdminAntTheme(dark, skin)]) {
                expect(theme.components?.Button).toMatchObject({
                    colorPrimary: "#123456",
                    colorPrimaryHover: "#234567",
                    colorPrimaryActive: "#345678",
                    primaryColor: "#abcdef",
                });
                expect(theme.token?.controlOutlineWidth).toBe(0);
                expect(theme.components?.Input?.activeShadow).toBe("none");
                expect(theme.components?.InputNumber?.activeShadow).toBe("none");
                expect(theme.components?.DatePicker?.activeShadow).toBe("none");
                expect(theme.components?.Select?.activeOutlineColor).toBe("transparent");
            }
        });
    }

    test("nighttime actions, ordinary selection and switches keep separate roles", () => {
        const theme = getAntThemeConfig(true, DEFAULT_CLASSIC_SKIN);
        expect(theme.components?.Button?.primaryColor).toBe("#171717");
        expect(theme.token?.colorBgElevated).toBe("rgba(31, 31, 32, 1)");
        expect(theme.token?.colorText).toBeUndefined();
        expect(theme.components?.Checkbox?.colorPrimary).toBe("#f5f5f5");
        expect(theme.components?.Switch?.colorPrimary).toBe("#22c55e");
    });

    test("daytime monochrome actions use readable link colors and subtle selection", () => {
        const theme = getAntThemeConfig(false, DEFAULT_CLASSIC_SKIN);
        expect(theme.components?.Button?.primaryColor).toBe("#ffffff");
        expect(theme.token?.colorLink).toBe("#171717");
        expect(theme.token?.colorPrimaryBg).toBe("rgba(17, 17, 17, 0.09)");
        expect(theme.token?.colorText).toBeUndefined();
        expect(theme.components?.Checkbox?.colorPrimary).toBe("#171717");
    });

    test("workspace density overrides inherit action colors and shadow-free focus", () => {
        const theme = getWorkspaceAntThemeConfig();
        expect(theme.components?.Button?.colorPrimary).toBeUndefined();
        expect(theme.components?.Button?.primaryColor).toBeUndefined();
        expect(theme.components?.Input?.activeShadow).toBe("none");
    });
});
