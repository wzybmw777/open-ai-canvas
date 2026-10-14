import { expect, test } from "bun:test";
import { watermarkTaskSearchParams } from "../src/pages/workbench/use-watermark-task";

test("视频异步提交保留当前图片页签及图片历史任务", () => {
    const current = new URLSearchParams("type=image&imageTask=image-job&videoTask=old-video");
    const next = watermarkTaskSearchParams(current, "video", "new-video");
    expect(next.get("type")).toBe("image");
    expect(next.get("imageTask")).toBe("image-job");
    expect(next.get("videoTask")).toBe("new-video");
    expect(current.get("videoTask")).toBe("old-video");
});

test("更换图片仅清除图片任务，保留视频任务及所选页签", () => {
    const current = new URLSearchParams("type=video&imageTask=image-job&videoTask=video-job");
    const next = watermarkTaskSearchParams(current, "image", "");
    expect(next.has("imageTask")).toBe(false);
    expect(next.get("videoTask")).toBe("video-job");
    expect(next.get("type")).toBe("video");
});
