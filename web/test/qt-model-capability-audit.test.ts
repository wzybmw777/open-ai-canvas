import { expect, test } from "bun:test";
import { auditCapabilities } from "../../scripts/qt-channel-capabilities.mjs";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { modelCompatibilityError } from "../src/lib/model-selection";
import { defaultConfig, type AiConfig, type ModelChannel } from "../src/stores/use-config-store";

test("reviewed QT Wan contract passes the real canvas multimodal gate and rejects excess inputs", () => {
    const capabilityConfig = defaultModelCapabilityConfig(undefined, "wan30-720p");
    capabilityConfig.video!.references.maxImages = 10;
    const report = auditCapabilities({ code: 0, data: { groups: [{ id: 83, name: "万有引力图片视频组", models: [{
        name: "wan30-720p", description: "4–30 秒，带参考视频时 4–15 秒；10 图、5 视频、5 音频",
    }] }] } }, { models: [{ id: "test", model_key: "wan30-720p", capability: "video", protocol: "lxmone-wan-videos",
        capability_version: 1, capability_config_json: JSON.stringify(capabilityConfig) }] });
    const corrected = JSON.parse(report.changes[0].after);
    const channel: ModelChannel = { id: "qt", name: "QT", scope: "system", baseUrl: "/api", apiKey: "system", apiFormat: "openai",
        models: ["wan30-720p"], modelCosts: [{ model: "wan30-720p", capability: "video", billingMode: "per_second",
            unitPriceMicrocredits: 1, capabilityConfig: corrected }] };
    const config: AiConfig = { ...defaultConfig, channels: [channel] };
    const input = { textCount: 1, imageCount: 3, videoCount: 0, audioCount: 0, characterCount: 0 };
    const error = (overrides = {}, seconds = "6") => modelCompatibilityError(config, "qt::wan30-720p", {
        capability: "video", videoSeconds: seconds, input: { ...input, ...overrides },
    });
    expect(error()).toBe("");
    expect(error({ imageCount: 10, videoCount: 5, audioCount: 5 }, "15")).toBe("");
    expect(error({ imageCount: 11 })).toContain("参考图");
    expect(error({ videoCount: 6 })).toContain("参考视频");
    expect(error({ audioCount: 6 })).toContain("参考音频");
    expect(error({}, "3")).toContain("时长");
    expect(error({}, "30")).toBe("");
    expect(error({ audioCount: 1 }, "30")).toBe("");
    expect(error({ videoCount: 1 }, "16")).toContain("最长 15 秒");
    expect(error({ videoCount: 1 }, "30")).toContain("最长 15 秒");
});
