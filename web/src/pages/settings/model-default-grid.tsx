import { AudioLines, Check, Film, Image, MessageSquareText } from "lucide-react";

import { ModelIcon } from "@/components/model-picker";
import { cn } from "@/lib/utils";
import {
    filterModelsByCapability,
    modelDisplayName,
    modelOptionName,
    resolveModelChannel,
    type AiConfig,
    type ModelCapability,
} from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { localeText, useLocaleText } from "@/lib/i18n";

type DefaultModelKey = "imageModel" | "videoModel" | "textModel" | "audioModel";

const groups: Array<{
    capability: ModelCapability;
    modelKey: DefaultModelKey;
    title: string;
    englishTitle: string;
    description: string;
    englishDescription: string;
    icon: typeof Image;
}> = [
    { capability: "image", modelKey: "imageModel", title: "默认生图模型", englishTitle: "Default image model", description: "图片生成、图像编辑与视觉探索", englishDescription: "Image generation, editing, and visual exploration", icon: Image },
    { capability: "video", modelKey: "videoModel", title: "默认视频模型", englishTitle: "Default video model", description: "文生视频、图生视频与镜头延展", englishDescription: "Text to video, image to video, and shot extension", icon: Film },
    { capability: "text", modelKey: "textModel", title: "默认文本模型", englishTitle: "Default text model", description: "提示词改写、脚本与结构化文本", englishDescription: "Prompts, scripts, and structured text", icon: MessageSquareText },
    { capability: "audio", modelKey: "audioModel", title: "默认音频模型", englishTitle: "Default audio model", description: "语音、音效与音乐生成", englishDescription: "Speech, sound effects, and music", icon: AudioLines },
];

export function ModelDefaultGrid({ config, onChange }: { config: AiConfig; onChange: (key: DefaultModelKey, model: string) => void }) {
    const { locale, text } = useLocaleText();
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    return (
        <div className="space-y-1">
            {groups.map((group) => {
                const models = filterModelsByCapability(config.models, group.capability, config.channels);
                const Icon = group.icon;
                return (
                    <section key={group.capability} className="py-5 first:pt-0 last:pb-0" aria-labelledby={`default-${group.capability}-title`}>
                        <div className="mb-3 flex items-start gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-active text-foreground/65"><Icon className="size-4" /></span>
                            <div className="min-w-0">
                                <h3 id={`default-${group.capability}-title`} className="text-sm font-semibold">{localeText(group.title, group.englishTitle, locale)}</h3>
                                <p className="mt-0.5 text-xs text-foreground/48">{localeText(group.description, group.englishDescription, locale)}</p>
                            </div>
                            <span className="ml-auto shrink-0 text-xs tabular-nums text-foreground/38">{locale === "en-US" ? `${models.length} available` : `${models.length} 个可用`}</span>
                        </div>
                        {models.length ? (
                            <div role="radiogroup" aria-label={localeText(group.title, group.englishTitle, locale)} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                {models.map((model) => {
                                    const channel = resolveModelChannel(config, model);
                                    const selected = config[group.modelKey] === model;
                                    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
                                    return (
                                        <button
                                            key={model}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            className={cn(
                                                "model-default-option group relative overflow-hidden rounded-md px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                                                selected && "is-selected",
                                            )}
                                            onClick={() => onChange(group.modelKey, model)}
                                        >
                                            <span className="flex min-w-0 items-start gap-2.5">
                                                <span className="model-default-option-icon grid size-8 shrink-0 place-items-center rounded-md">
                                                    <ModelIcon config={config} model={model} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-xs font-semibold">{modelDisplayName(config, model)}</span>
                                                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--fs-tiny)] text-foreground/45">
                                                        <span className="max-w-full truncate">{channel.name || text("未命名渠道", "Unnamed channel")}</span>
                                                        <span className="model-default-option-scope">{channel.scope === "system" ? text("系统", "System") : text("自定义", "Custom")}</span>
                                                        {creditsEnabled && cost ? <span className="model-default-price">{formatPrice(cost.billingMode === "token" ? (cost.outputTokenPriceMicrocredits || 0) : cost.unitPriceMicrocredits, locale)} /{cost.billingMode === "token" ? text("百万 Token", "1M tokens") : cost.billingMode === "per_second" ? text("秒", "second") : text("次", "run")}</span> : null}
                                                    </span>
                                                </span>
                                                <span className={cn("model-default-option-check grid size-5 shrink-0 place-items-center rounded-full", selected ? "is-selected" : "text-transparent")}>
                                                    <Check className="size-3" strokeWidth={2.5} />
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="rounded-md bg-surface-active px-4 py-6 text-center text-xs text-foreground/45">{locale === "en-US" ? `No ${capabilityLabel(group.capability, locale)} models available in your channels` : `当前渠道中没有可用的${capabilityLabel(group.capability, locale)}模型`}</div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

function capabilityLabel(capability: ModelCapability, locale: "zh-CN" | "en-US") {
    return locale === "en-US" ? { image: "image", video: "video", text: "text", audio: "audio" }[capability] : { image: "图片", video: "视频", text: "文本", audio: "音频" }[capability];
}

function formatPrice(microcredits: number, locale: "zh-CN" | "en-US") {
    return (microcredits / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 6 });
}
