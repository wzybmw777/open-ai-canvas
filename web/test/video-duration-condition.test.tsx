import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { defaultModelCapabilityConfig, videoCapabilityForReferenceVideos, videoDurationAllowed, videoDurationOptions } from "../src/lib/model-capabilities";
import { assertVideoCapability } from "../src/services/api/video-validation";
import type { ReferenceVideo } from "../src/types/media";

function profile() {
    const profile = defaultModelCapabilityConfig(undefined, "wan30-720p").video!;
    profile.duration = { selection: "range", min: 4, max: 30, step: 1, default: 6, maxWithReferenceVideo: 15 };
    profile.references.maxVideos = 5;
    return profile;
}

test("reference video condition changes available durations without changing the base profile", () => {
    const base = profile();
    expect(videoDurationAllowed(base, 30, 0)).toBe(true);
    expect(videoDurationAllowed(base, 15, 1)).toBe(true);
    expect(videoDurationAllowed(base, 16, 1)).toBe(false);
    expect(videoDurationAllowed(base, 3, 0)).toBe(false);
    expect(videoDurationOptions(videoCapabilityForReferenceVideos(base, 1)).at(-1)).toBe(15);
    expect(videoDurationOptions(videoCapabilityForReferenceVideos(base, 0)).at(-1)).toBe(30);
    expect(base.duration.max).toBe(30);
});

test("conditional enum uses an allowed default and models without the condition retain their range", () => {
    const base = profile();
    base.duration = { selection: "enum", values: [10, 20, 30], default: 30, maxWithReferenceVideo: 15 };
    expect(videoCapabilityForReferenceVideos(base, 1).duration).toMatchObject({ values: [10], default: 10 });
    delete base.duration.maxWithReferenceVideo;
    expect(videoDurationAllowed(base, 30, 5)).toBe(true);
    expect(videoCapabilityForReferenceVideos(base, 1)).toBe(base);
});

test("actual video submission checks the reference count and explains the conditional limit", () => {
    const base = profile();
    const videos = [{ url: "https://example.com/reference.mp4" }] as ReferenceVideo[];
    expect(() => assertVideoCapability(base, [], [], [], "30")).not.toThrow();
    expect(() => assertVideoCapability(base, [], videos, [], "15")).not.toThrow();
    expect(() => assertVideoCapability(base, [], videos, [], "16")).toThrow("最长 15 秒");
});

test("both real admin editor sections expose the conditional output limit", () => {
    for (const section of ["protocol", "all"] as const) {
        const markup = renderToStaticMarkup(<ModelCapabilityEditor capability="video" section={section} value={{ version: 1, video: profile() }} />);
        expect(markup).toContain("有参考视频时输出最长秒数");
    }
});
