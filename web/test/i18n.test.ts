import { expect, test } from "bun:test";

import { formatLocalizedDate, localizedErrorMessage, preferredLocale } from "../src/lib/i18n";

test("saved locale takes precedence over browser languages", () => {
    const storage = { getItem: () => "zh-CN" };
    expect(preferredLocale(storage, ["en-US"])).toBe("zh-CN");
    expect(preferredLocale({ getItem: () => "en-US" }, ["zh-CN"])).toBe("en-US");
});

test("first browser language chooses locale when no selection is saved", () => {
    const storage = { getItem: () => null };
    expect(preferredLocale(storage, ["zh-HK", "en-US"])).toBe("zh-CN");
    expect(preferredLocale(storage, ["fr-FR", "zh-CN"])).toBe("en-US");
    expect(preferredLocale(storage, [])).toBe("en-US");
    expect(
        preferredLocale(
            {
                getItem: () => {
                    throw new Error("blocked");
                },
            },
            ["zh-CN"],
        ),
    ).toBe("zh-CN");
});

test("dates use the selected locale", () => {
    const date = new Date("2026-09-28T10:30:00Z");
    expect(formatLocalizedDate(date, { month: "long", timeZone: "UTC" }, "en-US")).toBe("September");
});

test("English API errors use machine-readable reason instead of Chinese response text", () => {
    const error = Object.assign(new Error("请求过于频繁"), { reason: "rate_limited" });
    expect(localizedErrorMessage(error, "操作失败", "Request failed", "en-US")).toBe("Too many requests. Try again later.");
    expect(localizedErrorMessage(error, "操作失败", "Request failed", "zh-CN")).toBe("请求过于频繁");
});
