import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { modelQuoteRequest } from "../src/lib/model-pricing";
import { creationVideoConfig } from "../src/pages/create/creation-generation-config";
import { runBackendCanvasGenerationTask } from "../src/lib/canvas/canvas-project-generation";
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

test("创作台无声视频报价、提交与重试不携带全局音频和水印默认值", async () => {
    const config = videoConfig({ supported: false, default: false });
    const requestConfig = creationVideoConfig(config, config.videoModel, { ratio: "16:9", seconds: "6", videoQuality: "480" });
    const quote = modelQuoteRequest(requestConfig, requestConfig.model, "video");
    expect(quote?.intent.options).toMatchObject({ size: "16:9", vquality: "480", videoSeconds: 6, videoGenerateAudio: false, videoWatermark: false });

    for (const retryOf of [undefined, "failed-task"]) {
        const task = await prepareBackendGenerationTask({ mode: "video", prompt: "小猫在流泪", config: requestConfig, retryOf });
        expect(task.input).toMatchObject({
            config: { size: "16:9", vquality: "480", videoSeconds: "6", videoGenerateAudio: "false", videoWatermark: "false" },
            ...(retryOf ? { metadata: { retryOf } } : {}),
        });
        expect(task.operation).toBe("text_to_video");
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

test("画布生成入口显式标记 canvas 奖励类别", async () => {
    const config = videoConfig({ supported: true, default: false });
    let captured: any;
    const task = { id: "task-1", type: "canvas_video", status: "queued", prompt: "小猫在奔跑", attempts: 0, createdAt: "now", updatedAt: "now", resultJson: JSON.stringify({ mode: "video", video: { dataUrl: "blob:video" } }) } as any;
    await runBackendCanvasGenerationTask({ projectId: "canvas-project", nodeId: "node-1", mode: "video", prompt: "小猫在奔跑", config }, {
        createTask: async (input) => { captured = input; return task; },
        waitTask: async () => task,
        createId: () => "client-id",
    });
    expect(captured.input.metadata.generationSurface).toBe("canvas");
});

test.each([false, true])("创作台支持同步音频时遵循模型默认值 %s", (audioDefault) => {
    const config = videoConfig({ supported: true, default: audioDefault });
    config.videoGenerateAudio = String(!audioDefault);
    const requestConfig = creationVideoConfig(config, config.videoModel, { ratio: "16:9", seconds: "6", videoQuality: "480" });
    expect(requestConfig.videoGenerateAudio).toBe(String(audioDefault));
    expect(modelQuoteRequest(requestConfig, requestConfig.model, "video")?.intent.options?.videoGenerateAudio).toBe(audioDefault);
});
