import { expect, test } from "bun:test";
import { isVideoCleanupTask } from "../src/lib/video-cleanup";

test("视频去水印历史兼容任务摘要和完整任务", () => {
    expect(isVideoCleanupTask({ clientContext: { videoCleanup: true } })).toBe(true);
    expect(isVideoCleanupTask({ inputJson: JSON.stringify({ metadata: { source: "workbench", workbenchKind: "video", edit: "remove_watermark" } }) })).toBe(true);
    expect(isVideoCleanupTask({ inputJson: JSON.stringify({ metadata: { source: "workbench", workbenchKind: "image", edit: "remove_watermark" } }) })).toBe(false);
    expect(isVideoCleanupTask({ inputJson: "broken" })).toBe(false);
});
