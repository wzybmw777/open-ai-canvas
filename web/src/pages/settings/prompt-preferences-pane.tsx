import { App, Button, Input, Skeleton, Tabs } from "antd";
import { Select } from "@/components/ui/base/select";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { StatusBadge } from "@/components/ui/base/badges";
import { Callout } from "@/components/ui/product/callout";
import { EmptyState } from "@/components/ui/product/empty-state";
import { RotateCcw, Save, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PromptCodeEditor } from "@/components/prompt/prompt-code-editor";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import {
    listUserPromptPreferences,
    resetUserPromptCustomization,
    updateUserPromptCustomization,
    type UserPromptCustomization,
    type UserPromptPreference,
} from "@/services/api/auth";

type CustomizationMode = UserPromptCustomization["mode"];

const modeOptions = [
    { label: "跟随平台", value: "inherit" },
    { label: "追加要求", value: "append" },
    { label: "高级改写", value: "rewrite" },
];

export function PromptPreferencesPane() {
    const { locale, text } = useLocaleText();
    const { message, modal } = App.useApp();
    const [preferences, setPreferences] = useState<UserPromptPreference[]>([]);
    const [selectedOperation, setSelectedOperation] = useState("");
    const [mode, setMode] = useState<CustomizationMode>("inherit");
    const [appendContent, setAppendContent] = useState("");
    const [rewriteContent, setRewriteContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const requestIdRef = useRef(0);

    const reload = async (preferredOperation?: string) => {
        const reqId = ++requestIdRef.current;
        setLoading(true);
        setLoadError("");
        try {
            const result = await listUserPromptPreferences();
            if (reqId !== requestIdRef.current) return;
            setPreferences(result.preferences);
            setSelectedOperation((current) => preferredOperation || current || result.preferences[0]?.definition.operation || "");
        } catch (error) {
            if (reqId !== requestIdRef.current) return;
            const msg = localizedErrorMessage(error, "读取提示词偏好失败", "Could not load prompt preferences", locale);
            setLoadError(msg);
            message.error(msg);
        } finally {
            if (reqId === requestIdRef.current) {
                setLoading(false);
            }
        }
    };

    useEffect(() => { void reload(); }, []);

    const selected = useMemo(() => preferences.find((item) => item.definition.operation === selectedOperation), [preferences, selectedOperation]);
    const savedMode = selected?.customization?.mode || "inherit";
    const savedAppendContent = savedMode === "append" ? selected?.customization?.content || "" : "";
    const savedRewriteContent = savedMode === "rewrite" ? selected?.customization?.content || "" : selected?.template?.content || "";
    const activeContent = mode === "append" ? appendContent : mode === "rewrite" ? rewriteContent : "";
    const savedActiveContent = savedMode === "append" ? savedAppendContent : savedMode === "rewrite" ? savedRewriteContent : "";
    const dirty = mode !== savedMode || activeContent !== savedActiveContent;

    const restoreDraft = (preference = selected) => {
        const customization = preference?.customization;
        setMode(customization?.mode || "inherit");
        setAppendContent(customization?.mode === "append" ? customization.content : "");
        setRewriteContent(customization?.mode === "rewrite" ? customization.content : preference?.template?.content || "");
    };

    useEffect(() => { restoreDraft(selected); }, [selected]);

    useEffect(() => {
        if (!dirty) return undefined;
        const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener("beforeunload", preventUnload);
        return () => window.removeEventListener("beforeunload", preventUnload);
    }, [dirty]);

    const selectOperation = (operation: string) => {
        if (operation === selectedOperation) return;
        if (!dirty) {
            setSelectedOperation(operation);
            return;
        }
        modal.confirm({
            title: text("切换模板并放弃修改？", "Switch templates and discard changes?"),
            content: text("当前模板还有未保存内容。切换后这些修改将丢失。", "Your unsaved changes to this template will be lost."),
            okText: text("放弃并切换", "Discard and switch"),
            cancelText: text("继续编辑", "Keep editing"),
            okButtonProps: { danger: true },
            onOk: () => setSelectedOperation(operation),
        });
    };

    const save = async () => {
        if (!selected) return;
        const content = mode === "append" ? appendContent : mode === "rewrite" ? rewriteContent : "";
        if (mode !== "inherit" && !content.trim()) {
            message.warning(text("请填写个人提示词内容", "Enter your prompt instructions"));
            return;
        }
        setSaving(true);
        try {
            await updateUserPromptCustomization(selected.definition.operation, { mode, content });
            await reload(selected.definition.operation);
            message.success(text("提示词偏好已保存", "Prompt preferences saved"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "保存提示词偏好失败", "Could not save prompt preferences", locale));
        } finally {
            setSaving(false);
        }
    };

    const reset = () => {
        if (!selected) return;
        modal.confirm({
            title: text("恢复平台模板？", "Restore platform template?"),
            content: locale === "en-US" ? `Your customization of "${selected.definition.label}" will be removed. Future platform updates will apply automatically.` : `将删除“${selected.definition.label}”的个人定制，后续自动跟随平台版本。`,
            okText: text("恢复平台模板", "Restore template"),
            cancelText: text("取消", "Cancel"),
            onOk: async () => {
                try {
                    await resetUserPromptCustomization(selected.definition.operation);
                    await reload(selected.definition.operation);
                    message.success(text("已恢复平台模板", "Platform template restored"));
                } catch (error) {
                    message.error(localizedErrorMessage(error, "恢复平台模板失败", "Could not restore template", locale));
                }
            },
        });
    };

    if (loading && preferences.length === 0) return <Skeleton active paragraph={{ rows: 10 }} />;
    if (loadError && preferences.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Callout tone="error" title={text("加载提示词偏好失败", "Could not load prompt preferences")}>{loadError}</Callout>
                <Button icon={<RotateCcw className="size-4" />} onClick={() => void reload()}>{text("重试", "Retry")}</Button>
            </div>
        );
    }
    if (!selected) return <EmptyState title={text("暂无可配置的提示词模板", "No prompt templates available")} />;

    const templateContent = selected.template?.content || text("当前没有启用的平台模板", "No active platform template");
    const previewCreative = mode === "inherit" ? templateContent : mode === "append" ? `${templateContent}\n\n【用户个性化创作要求】\n${appendContent}` : rewriteContent;
    const outputLabel = selected.definition.outputType === "json" ? selected.definition.schemaKey || "JSON" : text("文本", "Text");

    return (
        <div className="flex min-h-full flex-col">
            <header className="shrink-0 pb-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0 flex-1">
                         <label className="mb-2 block text-xs font-medium text-foreground/55">{text("提示词模板", "Prompt template")}</label>
                        <Select
                             ariaLabel={text("提示词模板", "Prompt template")}
                            className="w-full max-w-md"
                            value={selectedOperation}
                            onChange={selectOperation}
                            options={preferences.map((item) => ({
                                value: item.definition.operation,
                                label: `${item.definition.category} · ${item.definition.label}${item.customization && item.customization.mode !== "inherit" ? ` · ${text("已定制", "Customized")}` : ""}`,
                            }))}
                        />
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <Button icon={<Undo2 className="size-4" />} disabled={!dirty || saving} onClick={() => restoreDraft()}>{text("撤销修改", "Discard changes")}</Button>
                        <Button icon={<RotateCcw className="size-4" />} disabled={!selected.customization || saving} onClick={reset}>{text("恢复平台", "Restore platform")}</Button>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={() => void save()}>{text("保存更改", "Save changes")}</Button>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold">{selected.definition.label}</h2>
                            <StatusBadge variant="filled" tone="neutral" label={`${text("平台", "Platform")} v${selected.template?.version || "--"}`} />
                            <StatusBadge variant="filled" tone="neutral" label={outputLabel} />
                            {dirty ? <StatusBadge variant="filled" tone="warning" label={text("未保存", "Unsaved")} /> : null}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">{selected.definition.description}</p>
                    </div>
<SegmentedControl value={mode} options={modeOptions.map((option) => ({ ...option, label: locale === "en-US" ? ({ inherit: "Follow platform", append: "Add instructions", rewrite: "Advanced rewrite" } as Record<string, string>)[option.value] : option.label }))} onChange={(value) => setMode(value as CustomizationMode)} />
                </div>
            </header>

            {selected.outdated ? <Callout className="mt-4" tone="warning" title={text("平台模板已更新", "Platform template updated")}>{text("当前高级改写基于旧版本。可以保留现有改写，或恢复平台后再基于新版本调整。", "Your advanced rewrite uses an older version. Keep it, or restore the platform template to revise it against the latest version.")}</Callout> : null}

            <div className="grid min-h-0 flex-1 gap-4 pt-4 lg:grid-cols-3">
                <section className="flex min-h-0 flex-col lg:col-span-2">
                    <div className="mb-3 shrink-0">
                        <h3 className="text-sm font-semibold">{mode === "inherit" ? text("当前平台模板", "Current platform template") : mode === "append" ? text("追加个人要求", "Additional instructions") : text("改写创作策略", "Rewrite creative strategy")}</h3>
                        <p className="mt-1 text-xs leading-5 text-foreground/50">
                            {mode === "inherit" ? text("平台升级后自动使用新版本。", "Updates automatically when the platform template changes.") : mode === "append" ? text("内容追加在平台策略之后，仍会自动继承平台升级。", "Your instructions follow the platform strategy and inherit future updates.") : text("只替换创作策略；动态项目数据和输出契约仍由服务端强制注入。", "Only the creative strategy changes. Project data and the output contract remain server controlled.")}
                        </p>
                    </div>
                    {mode === "append" ? (
                        <Input.TextArea
                            className="min-h-96 resize-none"
                            value={appendContent}
                            maxLength={12000}
                            showCount
                            placeholder={text("例如：仙侠项目采用明亮、宏大、高清的休闲剧质感；避免阴森恐怖色调，人物表演自然、轻松。", "For example: Use a bright, cinematic style with natural performances and a light tone.")}
                            onChange={(event) => setAppendContent(event.target.value)}
                        />
                    ) : (
                        <div className="min-h-96 flex-1 overflow-hidden rounded-md bg-surface-active">
                            <PromptCodeEditor
                                value={mode === "inherit" ? templateContent : rewriteContent}
                                readOnly={mode === "inherit"}
                                ariaLabel={mode === "inherit" ? text("平台提示词模板", "Platform prompt template") : text("个人提示词改写", "Personal prompt rewrite")}
                                onChange={mode === "rewrite" ? setRewriteContent : undefined}
                            />
                        </div>
                    )}
                </section>

                <aside className="min-h-0 pt-4 lg:pl-6 lg:pt-0">
                    <Tabs
                        size="small"
                        items={[
                            {
                                key: "baseline",
                                label: text("平台基线", "Platform baseline"),
                                children: <pre className="thin-scrollbar max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground/65">{templateContent}</pre>,
                            },
                            {
                                key: "contract",
                                label: text("输出契约", "Output contract"),
                                children: <div><div className="mb-3 flex items-center gap-2 text-xs font-medium"><ShieldCheck className="size-4" />{text("服务端只读", "Server controlled")}</div><pre className="thin-scrollbar max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground/65">{selected.definition.outputContract}</pre></div>,
                            },
                            {
                                key: "preview",
                                label: text("最终结构", "Final structure"),
                                children: <div className="space-y-5 text-xs leading-6"><section><div className="mb-2 font-medium text-foreground/80">{text("创作策略", "Creative strategy")}</div><pre className="thin-scrollbar max-h-64 overflow-auto whitespace-pre-wrap text-foreground/65">{previewCreative || text("尚未填写", "Not entered yet")}</pre></section><section><div className="mb-2 font-medium text-foreground/80">{text("运行时强制追加", "Added at runtime")}</div><p className="text-foreground/55">{text("当前剧情、项目画风、当前角色版本、画布资产与受保护输出契约。", "Current story, project style, character versions, canvas assets, and protected output contract.")}</p></section></div>,
                            },
                        ]}
                    />
                </aside>
            </div>
        </div>
    );
}
