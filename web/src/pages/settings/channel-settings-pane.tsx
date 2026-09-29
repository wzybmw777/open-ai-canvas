import { App, Button, Form, Input, Popconfirm, Segmented, Tooltip } from "antd";
import { Pencil, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ModelEditorModal } from "@/components/model-editor-modal";
import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { mergeFetchedChannelModelCosts } from "@/lib/channel-model-catalog";
import { localizedErrorMessage, useLocaleText, type AppLocale } from "@/lib/i18n";
import { fetchChannelModels } from "@/services/api/image";
import {
    createModelChannel,
    defaultBaseUrlForApiFormat,
    filterModelsByCapability,
    modelOptionsFromChannels,
    useConfigStore,
    type AiConfig,
    type ModelChannel,
} from "@/stores/use-config-store";
import { ChannelModelSettings } from "./channel-video-pricing";
import { Select } from "@/components/ui/base/select";

type UserChannelConnection = "openai" | "gemini";
type ChannelSettingsPaneProps = {
    onOpenModels: () => void;
    onOpenRunningHub?: () => void;
};

export function ChannelSettingsPane({ onOpenModels, onOpenRunningHub }: ChannelSettingsPaneProps) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const replaceConfig = useConfigStore((state) => state.replaceConfig);
    const [loadingChannelIds, setLoadingChannelIds] = useState<string[]>([]);
    const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
    const [newChannelId, setNewChannelId] = useState<string | null>(null);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");
    const runningHubReady = Boolean(config.runningHub.enabled && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim() && config.runningHub.workflowId.trim());

    const updateChannels = (channels: ModelChannel[], baseConfig = config) => {
        replaceConfig(withChannels(baseConfig, channels));
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => {
            if (channel.id !== id) return channel;
            const models = patch.models ? uniqueModels(patch.models) : channel.models;
            return {
                ...channel,
                ...patch,
                models,
                modelCosts: patch.modelCosts !== undefined ? patch.modelCosts : (patch.models ? channel.modelCosts?.filter((item) => models.includes(item.model)) : channel.modelCosts),
            };
        }));
    };

    const updateChannelConnection = (channel: ModelChannel, connection: UserChannelConnection) => {
        const apiFormat = connection;
        const defaultBaseUrl = defaultBaseUrlForApiFormat(apiFormat);
        const baseUrl = isKnownDefaultBaseUrl(channel.baseUrl) ? defaultBaseUrl : channel.baseUrl;
        // 渠道只负责连接类型；具体模型能力和请求协议由下方共享能力卡片维护。
        updateChannel(channel.id, { apiFormat, interfaceType: undefined, baseUrl });
    };

    const addChannel = () => {
        const channel = createModelChannel({ name: locale === "en-US" ? `Channel ${userChannels.length + 1}` : `渠道 ${userChannels.length + 1}` });
        updateChannels([...config.channels, channel]);
        setNewChannelId(channel.id);
        setEditingChannelId(channel.id);
    };

    const closeChannelEditor = () => {
        setEditingChannelId(null);
        setNewChannelId(null);
    };

    const deleteChannel = (id: string) => {
        const channel = config.channels.find((item) => item.id === id);
        if (channel?.scope === "system") {
            message.warning(text("系统渠道由管理员维护", "System channels are managed by administrators"));
            return;
        }
        updateChannels(config.channels.filter((item) => item.id !== id));
    };

    const setChannelLoading = (id: string, loading: boolean) => {
        setLoadingChannelIds((items) => (loading ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id)));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        const connectionError = channelConnectionError(channel, locale);
        if (connectionError) {
            message.error(`${channel.name || text("当前渠道", "Current channel")}: ${connectionError}`);
            return;
        }
        setChannelLoading(channel.id, true);
        try {
            const result = await fetchChannelModels(channel, true);
            if (!result.models.length) {
                message.warning(locale === "en-US" ? `${channel.name || "Current channel"} returned no models. Existing manual models were kept.` : `${channel.name || "当前渠道"}未返回模型，已保留现有手工模型`);
                return;
            }
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(channel)) {
                message.warning(locale === "en-US" ? `${latestChannel.name || "Current channel"} connection changed. The earlier result was ignored.` : `${latestChannel.name || "当前渠道"}的连接配置已改变，已忽略旧的拉取结果`);
                return;
            }
            updateChannels(
                latestConfig.channels.map((item) => (item.id === channel.id ? { ...item, models: result.models, modelCosts: mergeFetchedChannelModelCosts(item, result.catalog) } : item)),
                latestConfig,
            );
            message.success(locale === "en-US" ? `${latestChannel.name || "Current channel"} models updated` : `${latestChannel.name || "当前渠道"}模型列表已更新`);
        } catch (error) {
            message.error(channelModelFetchErrorMessage(error, locale));
        } finally {
            setChannelLoading(channel.id, false);
        }
    };

    const refreshAllModels = async () => {
        const runnable = userChannels.filter((channel) => !channelConnectionError(channel, locale));
        const skipped = userChannels.filter((channel) => channelConnectionError(channel, locale));
        if (!runnable.length) {
            const detail = skipped.map((channel) => `${channel.name || text("未命名渠道", "Unnamed channel")}: ${channelConnectionError(channel, locale)}`).join("; ");
            message.error(detail || text("没有可拉取的个人模型渠道，请先填写有效 Base URL 和 API Key", "No channels can be fetched. Enter a valid Base URL and API Key."));
            return;
        }
        setChannelLoading("all", true);
        try {
            const results = await Promise.all(
                runnable.map(async (channel) => {
                    try {
                        const result = await fetchChannelModels(channel, true);
                        return { channel, result, error: "" };
                    } catch (error) {
                        return { channel, result: { models: [], catalog: [] }, error: localizedErrorMessage(error, "读取失败", "Fetch failed", locale) };
                    }
                }),
            );
            const latestConfig = useConfigStore.getState().config;
            const successful = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && latestChannel && channelConnectionSignature(latestChannel) === channelConnectionSignature(item.channel));
            });
            const stale = results.filter((item) => {
                const latestChannel = latestConfig.channels.find((channel) => channel.id === item.channel.id);
                return Boolean(item.result.models.length && (!latestChannel || channelConnectionSignature(latestChannel) !== channelConnectionSignature(item.channel)));
            });
            const failed = results.filter((item) => !item.result.models.length);
            if (successful.length) {
                const resultMap = new Map(successful.map((item) => [item.channel.id, item.result] as const));
                updateChannels(
                    latestConfig.channels.map((channel) => {
                        const fetched = resultMap.get(channel.id);
                        return fetched ? { ...channel, models: fetched.models, modelCosts: mergeFetchedChannelModelCosts(channel, fetched.catalog) } : channel;
                    }),
                    latestConfig,
                );
                message.success(locale === "en-US" ? `Updated models for ${successful.length} channels` : `已更新 ${successful.length} 个渠道的模型`);
            }
            const warnings = [
                ...failed.map((item) => `${item.channel.name || text("未命名渠道", "Unnamed channel")}: ${item.error || text("未返回模型", "No models returned")}`),
                ...stale.map((item) => `${item.channel.name || text("未命名渠道", "Unnamed channel")}: ${text("连接配置已改变，已忽略旧结果", "Connection changed; earlier result ignored")}`),
                ...skipped.map((channel) => `${channel.name || text("未命名渠道", "Unnamed channel")}: ${channelConnectionError(channel, locale)}`),
            ];
            if (warnings.length) message.warning(`${warnings.join("; ")}. ${text("未更新的渠道已保留原有模型列表", "Channels without updates kept their existing models")}`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "批量读取模型失败，原有模型列表未改动", "Could not fetch models. Existing models were not changed.", locale));
        } finally {
            setChannelLoading("all", false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>{text("个人渠道", "Personal channels")}</h2>
                    <p>{text("管理个人模型服务和工作流渠道。普通渠道只保存连接类型；模型能力在“模型与能力”中配置。", "Manage your model services and workflow channels. Set each model's capabilities and pricing below.")}<Button type="link" size="small" className="h-auto p-0 text-xs font-semibold" onClick={onOpenModels}>{text("打开模型选择", "Open model selection")}</Button></p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" icon={<RefreshCw className="size-4" />} loading={loadingChannelIds.includes("all")} disabled={loadingChannelIds.some((id) => id !== "all")} onClick={() => void refreshAllModels()}>{text("拉取全部", "Fetch all")}</Button>
                    <Button className="h-10 flex-1 sm:h-8 sm:flex-none" type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>{text("新增渠道", "Add channel")}</Button>
                </div>
            </div>
            {onOpenRunningHub ? <section className="settings-section mb-3">
                <div className="mb-3">
                    <h3 className="text-sm font-semibold">{text("个人工作流渠道", "Workflow channels")}</h3>
                    <p className="mt-1 text-xs text-foreground/55">{text("RunningHub 使用独立的云端工作流参数与执行通道。", "RunningHub has its own workflow settings and execution channel.")}</p>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                    {onOpenRunningHub ? (
                        <WorkflowChannelEntry
                            icon={<Workflow className="size-4" />}
                            title="RunningHub"
                            description={text("云端工作流和 RunningHub App", "Cloud workflows and RunningHub Apps")}
                            status={runningHubReady ? locale === "en-US" ? `${config.runningHub.workflows.length} workflows configured` : `${config.runningHub.workflows.length} 个工作流已配置` : config.runningHub.enabled ? text("待完成连接和工作流配置", "Connection or workflow setup required") : text("未启用", "Disabled")}
                            ready={runningHubReady}
                            onOpen={onOpenRunningHub}
                        />
                    ) : null}
                </div>
            </section> : null}
            {userChannels.length ? (
                <div className="settings-channel-list space-y-2">
                    {userChannels.map((channel) => {
                        const editing = editingChannelId === channel.id;
                        return (
                            <section key={channel.id} aria-labelledby={`channel-${channel.id}-title`} className="settings-channel p-2.5 sm:p-3">
                                <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2.5">
                                    <div className="min-w-0 flex-1 basis-52">
                                        <h3 id={`channel-${channel.id}-title`} className="truncate text-sm font-semibold">{channel.name || text("未命名渠道", "Unnamed channel")}</h3>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground/55">
                                            {channelProtocolLabel(channel, locale)} · {locale === "en-US" ? `${channel.models.length} models saved` : `已保存 ${channel.models.length} 个模型`}
                                            <ChannelStatus channel={channel} />
                                        </div>
                                    </div>
                                    <div className="flex w-full justify-end gap-2 sm:w-auto sm:shrink-0">
                                        <Button className="h-10 sm:h-8" size="small" icon={<RefreshCw className="size-3.5" />} loading={loadingChannelIds.includes(channel.id)} disabled={loadingChannelIds.includes("all")} onClick={() => void refreshChannelModels(channel)}>{text("拉取模型", "Fetch models")}</Button>
                                        <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => { setNewChannelId(null); setEditingChannelId(channel.id); }}>{text("编辑", "Edit")}</Button>
                                        <Popconfirm title={text("删除个人模型渠道？", "Delete personal channel?")} description={text("该渠道关联的模型选择会同时移除。", "Its model selections will also be removed.")} okText={text("删除", "Delete")} cancelText={text("取消", "Cancel")} okButtonProps={{ danger: true }} onConfirm={() => deleteChannel(channel.id)}>
                                            <Tooltip title={text("删除渠道", "Delete channel")}><Button className="size-10 p-0 sm:size-8" aria-label={locale === "en-US" ? `Delete channel ${channel.name || "Unnamed channel"}` : `删除渠道 ${channel.name || "未命名渠道"}`} size="small" type="text" danger disabled={loadingChannelIds.includes(channel.id) || loadingChannelIds.includes("all")} icon={<Trash2 className="size-3.5" />} /></Tooltip>
                                        </Popconfirm>
                                    </div>
                                </div>
                                {editing && (
                                    <ModelEditorModal
                                        open
                                        title={channel.id === newChannelId ? text("新增自定义渠道", "Add custom channel") : text("编辑自定义渠道", "Edit custom channel")}
                                        subtitle={channel.name}
                                        onClose={closeChannelEditor}
                                        footer={<div className="model-editor-footer">
                                            <span className="text-xs text-foreground/50">{text("更改实时保存到云端渠道配置", "Changes are saved to your cloud channel settings")}</span>
                                            <div className="model-editor-footer-actions">
                                                <Button loading={loadingChannelIds.includes(channel.id)} onClick={() => void refreshChannelModels(channel)}>{text("拉取模型", "Fetch models")}</Button>
                                                <Button type="primary" onClick={closeChannelEditor}>{text("完成", "Done")}</Button>
                                            </div>
                                        </div>}
                                    >
                                        <div className="model-editor-panel">
                                            <section className="model-editor-section">
                                                <div>
                                                    <h2>{text("连接信息", "Connection")}</h2>
                                                    <p className="mt-1 text-xs text-foreground/50">{text("用于拉取模型目录并向当前渠道发起请求。", "Used to fetch model listings and send requests to this channel.")}</p>
                                                </div>
                                                <div className="model-editor-connection-fields grid gap-3 sm:grid-cols-2">
                                                    <Form.Item label={text("渠道名称", "Channel name")} htmlFor={`channel-${channel.id}-name`} className="mb-0 sm:col-span-1"><Input id={`channel-${channel.id}-name`} value={channel.name} placeholder={text("例如：我的 NewAPI", "For example: My NewAPI")} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} onBlur={(event) => updateChannel(channel.id, { name: event.target.value.trim() || text("未命名渠道", "Unnamed channel") })} /></Form.Item>
                                                    <Form.Item label={text("目录连接类型", "Catalog connection type")} className="mb-0 sm:col-span-1" extra={text("仅影响模型目录拉取。", "Only affects model catalog fetching.")}><Segmented<UserChannelConnection> block value={channelConnectionMode(channel)} options={[{ label: "OpenAI", value: "openai" }, { label: "Gemini", value: "gemini" }]} onChange={(value) => updateChannelConnection(channel, value)} /></Form.Item>
                                                    <Form.Item label="Base URL" htmlFor={`channel-${channel.id}-base-url`} className="mb-0 sm:col-span-1"><Input id={`channel-${channel.id}-base-url`} inputMode="url" value={channel.baseUrl} placeholder={text("填写云端渠道 Base URL", "Enter channel Base URL")} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} onBlur={(event) => updateChannel(channel.id, { baseUrl: event.target.value.trim().replace(/\/+$/u, "") })} /></Form.Item>
                                                    <Form.Item label="API Key" htmlFor={`channel-${channel.id}-api-key`} className="mb-0 sm:col-span-1"><Input.Password id={`channel-${channel.id}-api-key`} autoComplete="new-password" value={channel.apiKey} placeholder={channel.apiFormat === "gemini" ? text("填写 Gemini API Key", "Enter Gemini API Key") : text("填写当前渠道 API Key", "Enter channel API Key")} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} onBlur={(event) => updateChannel(channel.id, { apiKey: event.target.value.trim() })} /></Form.Item>
                                                    <Form.Item label={text("Secret Key（可选）", "Secret Key (optional)")} htmlFor={`channel-${channel.id}-secret-key`} className="mb-0 sm:col-span-1" extra={text("即梦等 AK/SK 协议需要；其他协议留空。", "Required for AK/SK protocols such as Jimeng; leave blank otherwise.")}><Input.Password id={`channel-${channel.id}-secret-key`} autoComplete="new-password" value={channel.secretKey || ""} placeholder={text("填写 Secret Key", "Enter Secret Key")} onChange={(event) => updateChannel(channel.id, { secretKey: event.target.value })} onBlur={(event) => updateChannel(channel.id, { secretKey: event.target.value.trim() })} /></Form.Item>
                                                    <div className="sm:col-span-2"><ChannelHeadersEditor value={channel.headers} onChange={(headers) => updateChannel(channel.id, { headers })} /></div>
                                                </div>
                                            </section>
                                            <section className="model-editor-section">
                                                <div>
                                                    <h2>{text("模型与能力", "Models and capabilities")}</h2>
                                                    <p className="mt-1 text-xs text-foreground/50">{text("维护渠道模型，并在单个模型中配置调用协议、能力和定价。", "Manage models, protocols, capabilities, and pricing for this channel.")}</p>
                                                </div>
                                                <Form.Item label={text("模型列表", "Model list")} htmlFor={`channel-${channel.id}-models`} className="mb-0"><Select id={`channel-${channel.id}-models`} mode="tags" showSearch allowClear maxTagCount="responsive" tokenSeparators={[",", "\n"]} placeholder={text("输入模型名，或点击拉取模型", "Enter a model name or fetch models")} value={channel.models} onChange={(models) => updateChannel(channel.id, { models: uniqueModels(models) })} /></Form.Item>
                                                <ChannelModelSettings channel={channel} onChange={(modelCosts) => updateChannel(channel.id, { modelCosts })} />
                                            </section>
                                        </div>
                                    </ModelEditorModal>
                                )}
                            </section>
                        );
                    })}
                </div>
            ) : <WorkspaceState icon="settings" compact title={text("当前没有个人模型渠道", "No personal model channels yet")} description={text("管理员配置的系统渠道会出现在模型选择中；也可以添加自己的模型服务。", "System channels appear in model selection. You can also add your own service.")} action={<Button icon={<Plus className="size-4" />} onClick={addChannel}>{text("新增个人模型渠道", "Add personal channel")}</Button>} />}
        </Form>
    );
}

function WorkflowChannelEntry({ icon, title, description, status, ready, onOpen }: { icon: ReactNode; title: string; description: string; status: string; ready: boolean; onOpen?: () => void }) {
    const { text } = useLocaleText();
    return (
        <div className="settings-channel flex min-w-0 items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-[var(--workspace-accent)]" aria-hidden="true">{icon}</span>
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold">{title}</h4>
                    <p className="mt-0.5 truncate text-xs text-foreground/55">{description}</p>
                    <span className={`settings-channel-status mt-1.5 ${ready ? "is-ready" : "is-warning"}`}><i aria-hidden="true" />{status}</span>
                </div>
            </div>
            <Button size="small" onClick={onOpen} disabled={!onOpen}>{text("配置", "Configure")}</Button>
        </div>
    );
}

export function channelValidationError(channel: ModelChannel, locale: AppLocale = "zh-CN") {
    const headerError = validateChannelHeaders(channel.headers);
    return channelConnectionError(channel, locale) || (headerError ? locale === "en-US" ? "Check the channel headers" : headerError : "") || (!channel.models.length ? locale === "en-US" ? "Add at least one model" : "请添加至少一个模型" : "");
}

export function isChannelReady(channel: ModelChannel) {
    return !channelValidationError(channel);
}

export function focusInvalidChannelField(channel: ModelChannel) {
    const baseUrlError = channelConnectionError({ ...channel, apiKey: "valid", secretKey: "valid" });
    const field = baseUrlError ? "base-url" : !channel.apiKey.trim() ? "api-key" : requiresSecretKey(channel) && !channel.secretKey?.trim() ? "secret-key" : "models";
    requestAnimationFrame(() => {
        const element = document.getElementById(`channel-${channel.id}-${field}`);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus({ preventScroll: true });
    });
}

function ChannelStatus({ channel }: { channel: ModelChannel }) {
    const { locale, text } = useLocaleText();
    const error = channelValidationError(channel, locale);
    return (
        <span className={`settings-channel-status ${error ? "is-warning" : "is-ready"}`}>
            <i aria-hidden="true" />
            {error || text("可用", "Ready")}
        </span>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = filterModelsByCapability(models, "image", channels);
    const videoModels = filterModelsByCapability(models, "video", channels);
    const textModels = filterModelsByCapability(models, "text", channels);
    const audioModels = filterModelsByCapability(models, "audio", channels);
    return { ...config, channels, models, baseUrl: channels[0]?.baseUrl || config.baseUrl, apiKey: channels[0]?.apiKey || config.apiKey, apiFormat: channels[0]?.apiFormat || config.apiFormat, imageModels, videoModels, textModels, audioModels, imageModel: normalizeDefaultModel(config.imageModel, imageModels), videoModel: normalizeDefaultModel(config.videoModel, videoModels), textModel: normalizeDefaultModel(config.textModel, textModels), audioModel: normalizeDefaultModel(config.audioModel, audioModels) };
}

function normalizeDefaultModel(value: string, options: string[]) {
    return options.includes(value) ? value : options[0] || "";
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function channelModelFetchErrorMessage(error: unknown, locale: AppLocale = "zh-CN") {
    if (locale === "en-US") return `${localizedErrorMessage(error, "读取模型失败", "Could not fetch models", locale)}. You can enter model names manually in the model list.`;
    const detail = error instanceof Error ? error.message : "读取模型失败";
    if (detail.includes("不允许访问本机") || detail.includes("不允许访问保留地址")) return `${detail}；可信私网服务需由部署管理员配置 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`;
    return `${detail}；也可以直接在模型列表中手动输入模型名`;
}

function channelConnectionMode(channel: ModelChannel): UserChannelConnection {
    return channel.apiFormat === "gemini" ? "gemini" : "openai";
}

function channelConnectionError(channel: ModelChannel, locale: AppLocale = "zh-CN") {
    const baseUrl = channel.baseUrl.trim();
    if (!baseUrl) return locale === "en-US" ? "Enter a Base URL" : "请填写 Base URL";
    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return locale === "en-US" ? "Base URL must use HTTP or HTTPS" : "Base URL 只支持 HTTP 或 HTTPS";
    } catch {
        return locale === "en-US" ? "Invalid Base URL" : "Base URL 格式不正确";
    }
    if (!channel.apiKey.trim()) return locale === "en-US" ? "Enter an API Key / Access Key" : "请填写 API Key / Access Key";
    if (requiresSecretKey(channel) && !channel.secretKey?.trim()) return locale === "en-US" ? "This protocol requires a Secret Key" : "当前协议需要填写 Secret Key";
    return "";
}

function channelConnectionSignature(channel: ModelChannel) {
    return [channel.baseUrl.trim(), channel.apiKey.trim(), channel.secretKey?.trim() || "", channel.apiFormat, JSON.stringify(channel.headers || [])].join("\n");
}

function channelProtocolLabel(channel: ModelChannel, locale: AppLocale = "zh-CN") {
    return channelConnectionMode(channel) === "gemini" ? locale === "en-US" ? "Gemini native" : "Gemini 原生" : locale === "en-US" ? "OpenAI compatible" : "OpenAI 兼容";
}

function isKnownDefaultBaseUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, "");
    if (!normalized) return true;
    return [defaultBaseUrlForApiFormat("openai"), defaultBaseUrlForApiFormat("gemini")].some((candidate) => candidate.replace(/\/+$/, "") === normalized);
}

function requiresSecretKey(channel: ModelChannel) {
    return channel.modelCosts?.some((item) => item.protocol?.startsWith("volcengine-jimeng-")) === true;
}
