import { describe, expect, test } from "bun:test";

import { isWatermarkNavigationVisible } from "../src/components/layout/workspace-sidebar-nav";

describe("AI 去水印侧栏入口", () => {
    test("只开启去水印时也显示入口", () => {
        expect(isWatermarkNavigationVisible({ watermarkRemovalEnabled: true })).toBe(true);
    });

    test("关闭去水印时隐藏入口", () => {
        expect(isWatermarkNavigationVisible({ watermarkRemovalEnabled: false })).toBe(false);
    });
});
