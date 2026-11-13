import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { modelQuoteRequest } from "../src/lib/model-pricing";
import { creationVideoConfig, creationVideoSettings } from "../src/pages/create/creation-generation-config";
import { runBackendCanvasGenerationTask } from "../src/lib/canvas/canvas-project-generation";
import { normalizeCreationComposerPreferences } from "../src/stores/use-creation-preferences-store";
import { prepareBackendGenerationTask } from "../src/services/api/generation-task";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";

function videoConfig(generateAudio: { supported: boolean; default: boolean }): AiConfig {
    const capabilityConfig = defaultModelCapabilityConfig();
    capabilityConfig.video!.generateAudio = generateAudio;
    capabilityConfig.video!.watermark = { supported: false, default: false };
    return {
        ...defaultConfig,
        model: "gravity::minimax-h3-a",
        videoModel: "gravity::minimax-h3-a",
        videoGenerateAudio: "true",
        videoWatermark: "true",
        channels: [
            {
                id: "gravity",
                name: "万有引力",
                baseUrl: "/api",
                apiKey: "",
                apiFormat: "openai",
                scope: "system",
                models: ["minimax-h3-a"],
                modelCosts: [{ model: "minimax-h3-a", capability: "video", billingMode: "per_second", unitPriceMicrocredits: 1, capabilityConfig }],
            },
        ],
    };
}

test("创作台自动关闭不适用音轨与水印，报价、提交与重试一致省略", async () => {
    const config = videoConfig({ supported: false, default: false });
    const requestConfig = creationVideoConfig(config, config.videoModel, { ratio: "16:9", seconds: "6", videoQuality: "480" });
    const quote = modelQuoteRequest(requestConfig, requestConfig.model, "video");
    expect(quote).toBeDefined();
    expect(quote?.intent.options).not.toHaveProperty("videoGenerateAudio");
    expect(quote?.intent.options).not.toHaveProperty("videoWatermark");
    expect(requestConfig.videoGenerateAudio).toBe("false");
    expect(requestConfig.videoWatermark).toBe("false");

    for (const retryOf of [undefined, "failed-task"]) {
        const task = await prepareBackendGenerationTask({ mode: "video", prompt: "小猫在流泪", config: requestConfig, retryOf });
        expect(task.input.config).toMatchObject({ videoGenerateAudio: undefined, videoWatermark: undefined });
    }
    expect(config.videoGenerateAudio).toBe("true");
    expect(config.videoWatermark).toBe("true");
});

test("关联画布项目的创作页任务仍按生成模式记录，不自动标记为画布生成", async () => {
    const config = videoConfig({ supported: true, default: false });
    const task = await prepareBackendGenerationTask({ projectId: "canvas-project", mode: "video", prompt: "小猫在奔跑", config });
    const metadata = (task.input as Record<string, any>).metadata;
    expect(metadata?.generationSurface).toBeUndefined();
});

test("画布生成入口传递归属、节点、逻辑模型与重试身份给真实计费任务", async () => {
    const config = videoConfig({ supported: true, default: false });
    let captured: any;
    const task = { id: "task-1", type: "canvas_video", status: "queued", prompt: "小猫在奔跑", attempts: 0, createdAt: "now", updatedAt: "now", resultJson: JSON.stringify({ mode: "video", video: { dataUrl: "blob:video" } }) } as any;
    await runBackendCanvasGenerationTask(
        { projectId: "canvas-project", nodeId: "node-1", mode: "video", prompt: "小猫在奔跑", config, retryOf: "failed-task", clientOperationId: "retry-operation" },
        {
            createTask: async (input) => {
                captured = input;
                return task;
            },
            waitTask: async () => task,
            createId: () => "client-id",
        },
    );
    expect(captured).toMatchObject({ projectId: "canvas-project", prompt: "小猫在奔跑", type: "canvas_video", operation: "text_to_video", model: "gravity::minimax-h3-a" });
    expect(captured.input).toMatchObject({ metadata: { nodeId: "node-1", retryOf: "failed-task", clientOperationId: "retry-operation" } });
});

test.each([false, true])("创作台支持同步音频时保留已有开关，不被默认值 %s 覆盖", (audioDefault) => {
    const config = videoConfig({ supported: true, default: audioDefault });
    config.videoGenerateAudio = String(!audioDefault);
    config.videoWatermark = "false";
    const requestConfig = creationVideoConfig(config, config.videoModel, { ratio: "16:9", seconds: "6", videoQuality: "480" });
    expect(requestConfig.videoGenerateAudio).toBe(String(!audioDefault));
    expect(modelQuoteRequest(requestConfig, requestConfig.model, "video")?.intent.options?.videoGenerateAudio).toBe(!audioDefault);
});

for (const protocol of ["newapi", "openai-video", "newapi-channel-2", "volcengine-ark-video"]) {
    for (const protocolSource of ["model", "channel"]) {
        test(`创作页旧消息 auto 经偏好重开、模型切换、报价和提交在 ${protocolSource}/${protocol} 下保持一致`, async () => {
            const config = videoConfig({ supported: false, default: false });
            const channel = config.channels[0];
            const cost = channel.modelCosts![0];
            channel.interfaceType = protocolSource === "channel" ? protocol : "minimax-video";
            if (protocolSource === "model") cost.protocol = protocol;
            cost.capabilityConfig!.video!.resolutions = ["720p", "1080p"];
            cost.capabilityConfig!.video!.defaultResolution = "1080p";
            // 模拟切换/恢复到目标模型：全局旧选择不能代替传入模型的协议。
            const target = config.videoModel;
            config.model = "other::previous";
            const oldMessageSettings = { ratio: "16:9", seconds: "6", videoQuality: "auto", quality: "auto", count: "1" };
            const saved = normalizeCreationComposerPreferences(JSON.parse(JSON.stringify({ video: oldMessageSettings }))).video;
            const restored = creationVideoSettings(config, target, saved);
            const expected = protocol === "volcengine-ark-video" ? "1080" : "auto";
            expect(restored).toMatchObject({ ratio: "16:9", seconds: "6", videoQuality: expected });
            expect(creationVideoSettings(config, target, restored)).toEqual(restored);
            // 直接使用旧消息提交与先恢复偏好再提交，必须落到同一结果。
            const direct = creationVideoConfig(config, target, oldMessageSettings);
            const requestConfig = creationVideoConfig(config, target, restored);
            expect(direct).toEqual(requestConfig);
            expect(requestConfig.vquality).toBe(expected);
            const requirements = { capability: "video" as const, options: { size: oldMessageSettings.ratio, videoSeconds: Number(oldMessageSettings.seconds), vquality: oldMessageSettings.videoQuality } };
            const quote = modelQuoteRequest(requestConfig, target, "video", requirements)!;
            expect(quote).toBeDefined();
            for (const retryOf of [undefined, "failed-video"]) {
                const task = await prepareBackendGenerationTask({ mode: "video", prompt: "历史视频提示词", config: requestConfig, retryOf });
                expect(task.input.config.interfaceType).toBe(protocol);
                expect(task.input.config.vquality).toBe(quote.intent.options?.vquality);
                expect(task.input.config.vquality).toBe(protocol === "volcengine-ark-video" ? "1080p" : "auto");
                expect(task.input.config.videoSeconds).toBe(String(quote.intent.options?.videoSeconds));
                expect(task.input.config.size).toBe(quote.intent.options?.size);
            }
            // auto 与真正缺省分开：未保存分辨率时仍采用目标模型默认。
            expect(creationVideoSettings(config, target, { ratio: "16:9", seconds: "6" }).videoQuality).toBe("1080");
            expect(oldMessageSettings.videoQuality).toBe("auto");
        });
    }
}
