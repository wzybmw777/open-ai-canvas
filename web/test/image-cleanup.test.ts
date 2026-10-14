import { expect, test } from "bun:test";
import { isImageCleanupTask } from "../src/lib/image-cleanup";

test("去水印历史兼容任务摘要和完整任务，同时排除普通图片生成", () => {
    expect(isImageCleanupTask({ clientContext: { imageCleanup: true } })).toBe(true);
    expect(isImageCleanupTask({ inputJson: JSON.stringify({ metadata: { source: "workbench", workbenchKind: "image", edit: "remove_watermark" } }) })).toBe(true);
    expect(isImageCleanupTask({ inputJson: JSON.stringify({ metadata: { source: "workbench", workbenchKind: "video", edit: "remove_watermark" } }) })).toBe(false);
    expect(isImageCleanupTask({ inputJson: JSON.stringify({ metadata: { source: "canvas", edit: "mask" } }) })).toBe(false);
    expect(isImageCleanupTask({ inputJson: "broken" })).toBe(false);
    expect(isImageCleanupTask()).toBe(false);
});
