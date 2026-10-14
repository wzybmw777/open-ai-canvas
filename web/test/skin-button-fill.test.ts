import { describe, expect, test } from "bun:test";
import { applySkinTheme, DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition, getSkinButtonAppearance, isSkinButtonFill, normalizeSkinDefinition } from "../src/lib/skin-themes";

describe("theme primary button fills", () => {
    test("classic uses solid graphite-blue daytime and gold nighttime actions", () => {
        expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, "light")).toEqual({
            background: "#2f5ea8", hover: "#264f91", active: "#1f427a", foreground: "#ffffff",
        });
        expect(getSkinButtonAppearance(DEFAULT_CLASSIC_SKIN, "dark")).toEqual({
            background: "#f0b90b", hover: "#f8d33a", active: "#d9a60a", foreground: "#181a20",
        });
        expect(DEFAULT_CLASSIC_SKIN.tokens.light.selected).toBe("#e6eef9");
        expect(DEFAULT_CLASSIC_SKIN.tokens.dark.selected).toBe("#2b3139");
    });

    test("copies have independent fills and switching to solid clears every gradient state", () => {
        const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
        skin.tokens.buttons.light.mode = "gradient";
        skin.tokens.buttons.light.angle = 45;
        skin.tokens.buttons.light.start = "#123456";
        expect(DEFAULT_CLASSIC_SKIN.tokens.buttons.light.angle).toBe(115);
        expect(skin.tokens.buttons.dark.angle).toBe(115);
        expect(getSkinButtonAppearance(skin, "light").background).toBe("linear-gradient(45deg, #123456, #386fbc)");
        const values = new Map<string, string>();
        const doc = { documentElement: { dataset: {}, style: {
            removeProperty: (key: string) => values.delete(key), setProperty: (key: string, value: string) => values.set(key, value),
        } } } as unknown as Document;
        applySkinTheme(skin, "light", doc);
        skin.tokens.buttons.light.mode = "solid";
        Object.assign(skin.tokens.light, { primary: "#123456", primaryHover: "#234567", primaryActive: "#345678", primaryForeground: "#ffffff" });
        applySkinTheme(skin, "light", doc);
        expect(values.get("--button-primary-bg")).toBe("#123456");
        expect(values.get("--button-primary-hover-bg")).toBe("#234567");
        expect(values.get("--button-primary-active-bg")).toBe("#345678");
        applySkinTheme(DEFAULT_CLASSIC_SKIN, "dark", doc);
        expect(values.has("--background")).toBe(false);
        expect(values.get("--button-primary-fg")).toBe("#181a20");
        expect(values.get("--button-primary-bg")).toBe("#f0b90b");
    });

    test("legacy themes use solid defaults in both modes", () => {
        for (const original of [DEFAULT_CLASSIC_SKIN, duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"])]) {
            const legacy = JSON.parse(JSON.stringify(original));
            delete legacy.tokens.buttons;
            expect(normalizeSkinDefinition(legacy).tokens.buttons.light.mode).toBe("solid");
            expect(normalizeSkinDefinition(legacy).tokens.buttons.dark.mode).toBe("solid");
        }
    });

    test("a cached classic cannot restore the previous night palette", () => {
        const cached = JSON.parse(JSON.stringify(DEFAULT_CLASSIC_SKIN));
        cached.tokens.dark.primary = "#ffffff";
        cached.tokens.buttons.dark.mode = "gradient";
        expect(normalizeSkinDefinition(cached)).toEqual(DEFAULT_CLASSIC_SKIN);
    });

    test("invalid modes, angles and CSS injection cannot become runtime gradients", () => {
        for (const patch of [{ mode: "url(x)" }, { angle: 361 }, { angle: -1 }, { angle: 1.5 }, { angle: NaN }, { start: "red; background:url(x)" }, { foreground: "white" }]) {
            const skin = duplicateSkinDefinition(DEFAULT_CLASSIC_SKIN, ["classic"]);
            Object.assign(skin.tokens.buttons.light, patch);
            expect(isSkinButtonFill(skin.tokens.buttons.light)).toBe(false);
            expect(getSkinButtonAppearance(normalizeSkinDefinition(skin), "light").background).toBe(skin.tokens.light.primary);
        }
    });
});
