import { App, Button, Form, Input, Space } from "antd";
import { Check, Download, Pencil, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { ModelPicker } from "@/components/model-picker";
import { StatusBadge } from "@/components/ui/base/badges";
import { IconButton } from "@/components/ui/base/buttons";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import { localizedErrorMessage, useLocaleText, type AppLocale } from "@/lib/i18n";
import {
    agentMemoryCategoryLabel,
    AGENT_MEMORY_CATEGORIES,
    compactAgentMemories,
    createAgentMemory,
    decideAgentMemory,
    deleteAgentMemory,
    exportAgentMemories,
    getAgentMemorySettings,
    importAgentMemories,
    listAgentMemories,
    updateAgentMemory,
    updateAgentMemorySettings,
    type AgentMemory,
    type AgentMemoryBundle,
    type AgentMemoryCompactInterval,
    type AgentMemoryCompactView,
    type AgentMemoryRequest,
    type AgentMemoryStep,
} from "@/services/api/agent-memories";
import { encodeChannelModel, logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { Select } from "@/components/ui/base/select";

const COMPACT_INTERVALS: Array<{ value: AgentMemoryCompactInterval; label: string }> = [
    { value: "off", label: "手动" },
    { value: "daily", label: "每天" },
    { value: "weekly", label: "每周" },
    { value: "monthly", label: "每月" },
];

const STATUS_FILTERS = [
    { value: "all", label: "全部" },
    { value: "pending", label: "待审" },
    { value: "approved", label: "已批" },
    { value: "rejected", label: "已拒" },
] as const;

function memoryStatusTone(status: string) {
    if (status === "approved") return "success" as const;
    if (status === "rejected") return "error" as const;
    if (status === "pending") return "warning" as const;
    return "neutral" as const;
}

function memoryStatusLabel(status: string, locale: AppLocale) {
    if (locale === "en-US") return status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : status === "pending" ? "Pending" : status;
    if (status === "approved") return "已批准";
    if (status === "rejected") return "已拒绝";
    if (status === "pending") return "待审";
    return status;
}

function memoryCategoryLabel(key: string | undefined, locale: AppLocale) {
    if (locale === "en-US")
        return (
            ({ storyboard: "Storyboard", video: "Video generation", image: "Image generation", canvas: "Canvas", asset: "Assets", model: "Model selection", workflow: "Workflow order", billing: "Billing", other: "Other" } as Record<string, string>)[
                key || "other"
            ] || "Other"
        );
    return agentMemoryCategoryLabel(key);
}

function compactModelFields(config: AiConfig, selectedModel: string) {
    const model = selectedModel.trim();
    if (!model) return {};
    const agentConfig = { ...config, model };
    const requestConfig = resolveModelRequestConfig(agentConfig, model);
    return {
        logicalModelId: logicalModelIDForConfig(agentConfig) || undefined,
        channelId: requestConfig.channelId || undefined,
        channelModelKey: modelOptionName(model) || undefined,
        model,
    };
}

function restoreCompactModel(settings: AgentMemoryCompactView | null, fallback: string) {
    if (settings?.model?.trim()) return settings.model.trim();
    if (settings?.channelId && settings?.channelModelKey) return encodeChannelModel(settings.channelId, settings.channelModelKey);
    return fallback;
}

function compactStatusLabel(settings: AgentMemoryCompactView | null, locale: AppLocale) {
    if (!settings) return "";
    if (locale === "en-US") {
        if (settings.lastStatus === "queued") return "Queued for text model compression";
        if (settings.lastStatus === "running") return "Compressing memories with the text model";
        if (settings.lastStatus === "failed") return "Last compression failed";
        if (settings.lastStatus === "succeeded") {
            const summary = settings.summary;
            const parts = [summary?.merged ? `${summary.merged} merged` : "", summary?.rewritten ? `${summary.rewritten} rewritten` : "", summary?.removed ? `${summary.removed} removed` : ""].filter(Boolean);
            const when = settings.lastCompactAt ? new Date(settings.lastCompactAt).toLocaleString(locale) : "";
            return [when && `Last run ${when}`, parts.join(" · ") || "No changes needed"].filter(Boolean).join(" · ");
        }
        return "Compression uses your text model and may incur model charges.";
    }
    if (settings.lastStatus === "queued") return "已排队，等待文本模型压缩";
    if (settings.lastStatus === "running") return "正在调用文本模型压缩记忆";
    if (settings.lastStatus === "failed") return settings.lastError || "上次压缩失败";
    if (settings.lastStatus === "succeeded") {
        const summary = settings.summary;
        const parts = [summary?.merged ? `合并 ${summary.merged}` : "", summary?.rewritten ? `改写 ${summary.rewritten}` : "", summary?.removed ? `删除 ${summary.removed}` : ""].filter(Boolean);
        const when = settings.lastCompactAt ? new Date(settings.lastCompactAt).toLocaleString() : "";
        return [when && `上次 ${when}`, parts.join(" · ") || "模型认为没有需要改动的条目"].filter(Boolean).join(" · ");
    }
    return "压缩会按你的文本模型计费，把相近记忆合并、把含糊条目改清楚。";
}

type MemoryFormValues = {
    topic: string;
    category: string;
    situation: string;
    lesson?: string;
    source?: string;
    steps?: AgentMemoryStep[];
};

function toRequest(values: MemoryFormValues): AgentMemoryRequest {
    const steps = (values.steps || []).filter((step) => step.tool?.trim() && step.action?.trim());
    return {
        topic: values.topic.trim(),
        category: values.category,
        situation: values.situation.trim(),
        lesson: values.lesson?.trim() || undefined,
        source: values.source?.trim() || undefined,
        steps: steps.length ? steps : undefined,
    };
}

function AgentMemoryCompactCard({ compact = false, onApplied }: { compact?: boolean; onApplied: () => Promise<void> }) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [settings, setSettings] = useState<AgentMemoryCompactView | null>(null);
    const [model, setModel] = useState("");
    const [saving, setSaving] = useState(false);
    const [compacting, setCompacting] = useState(false);
    const seqRef = useRef(0);
    const busy = settings?.lastStatus === "queued" || settings?.lastStatus === "running";

    const loadSettings = useCallback(async () => {
        const seq = ++seqRef.current;
        try {
            const next = await getAgentMemorySettings();
            if (seq !== seqRef.current) return null;
            setSettings(next);
            setModel((current) => restoreCompactModel(next, current || config.textModel || ""));
            return next;
        } catch (error) {
            if (seq === seqRef.current) message.error(localizedErrorMessage(error, "读取压缩设置失败", "Could not load compression settings", locale));
            return null;
        }
    }, [config.textModel, message, locale]);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        if (!busy) return;
        const timer = window.setInterval(() => {
            void loadSettings().then((next) => {
                if (next?.lastStatus === "succeeded") void onApplied();
            });
        }, 3000);
        return () => window.clearInterval(timer);
    }, [busy, loadSettings, onApplied]);

    const persist = async (interval: AgentMemoryCompactInterval, selectedModel: string) => {
        setSaving(true);
        try {
            const next = await updateAgentMemorySettings({
                compactInterval: interval,
                ...compactModelFields(config, selectedModel),
            });
            setSettings(next);
            setModel(restoreCompactModel(next, selectedModel));
        } catch (error) {
            message.error(localizedErrorMessage(error, "保存压缩设置失败", "Could not save compression settings", locale));
        } finally {
            setSaving(false);
        }
    };

    const runCompact = async () => {
        const selected = model.trim();
        if (!selected) {
            message.warning(text("请先选择用于压缩的文本模型", "Select a text model for compression"));
            return;
        }
        setCompacting(true);
        try {
            const next = await compactAgentMemories(compactModelFields(config, selected));
            setSettings(next);
            message.success(text("已提交压缩任务，完成后会刷新记忆列表", "Compression started. Memories will refresh when it finishes."));
        } catch (error) {
            message.error(localizedErrorMessage(error, "提交压缩失败", "Could not start compression", locale));
        } finally {
            setCompacting(false);
        }
    };

    const statusText = compactStatusLabel(settings, locale);
    const failed = settings?.lastStatus === "failed";

    return (
        <section className={compact ? "space-y-2.5" : "space-y-3 rounded-2xl bg-surface-secondary/80 px-4 py-3.5"}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground">{text("压缩优化", "Compress memories")}</h3>
                    {compact ? null : <p className="mt-0.5 text-caption leading-5 text-muted-foreground">{text("按文本模型计费，合并相近条目、改写含糊内容。", "Uses your text model to merge similar entries and clarify vague ones.")}</p>}
                </div>
                <Button size="small" icon={<Sparkles className="size-3.5" />} loading={compacting || busy} disabled={!model.trim()} onClick={() => void runCompact()}>
                    {busy ? text("压缩中", "Compressing") : text("立即压缩", "Compress now")}
                </Button>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
                <SegmentedControl
                    size="sm"
                    ariaLabel={text("压缩周期", "Compression interval")}
                    value={settings?.compactInterval || "off"}
                    disabled={saving || busy}
                    options={COMPACT_INTERVALS.map((option) => ({ ...option, label: locale === "en-US" ? { off: "Manual", daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[option.value] : option.label }))}
                    onChange={(value) => void persist(value, model)}
                />
                <div className="min-w-0 overflow-hidden rounded-xl bg-surface-tertiary">
                    <ModelPicker
                        config={config}
                        value={model}
                        capability="text"
                        variant="creation"
                        fullWidth
                        showSelectedPrice
                        showOptionPrices
                        className="!h-9 !min-h-9 !border-0 !bg-transparent !shadow-none"
                        placeholder={text("选择压缩用的文本模型", "Select a text model for compression")}
                        onChange={(value) => {
                            setModel(value);
                            void persist(settings?.compactInterval || "off", value);
                        }}
                    />
                </div>
            </div>
            {failed && settings?.lastError ? (
                <Callout tone="warning" title={text("上次压缩未完成", "Last compression did not complete")}>
                    {locale === "en-US" ? "Check the selected model and try again." : settings.lastError}
                </Callout>
            ) : statusText ? (
                <p className="text-caption leading-5 text-muted-foreground">{statusText}</p>
            ) : null}
        </section>
    );
}

export default function AgentMemoryPane({ compact = false }: { compact?: boolean }) {
    const { locale, text } = useLocaleText();
    const { message, modal } = App.useApp();
    const [items, setItems] = useState<AgentMemory[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<string>("all");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<AgentMemory | null>(null);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<MemoryFormValues>();
    const fileRef = useRef<HTMLInputElement>(null);
    const seqRef = useRef(0);

    const load = useCallback(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const data = await listAgentMemories(status === "all" ? undefined : status, 200);
            if (seq !== seqRef.current) return;
            setItems(data.memories || []);
        } catch (error) {
            if (seq === seqRef.current) message.error(localizedErrorMessage(error, "读取记忆失败", "Could not load memories", locale));
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [message, status, locale]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ category: "other", steps: [] });
        setEditorOpen(true);
    };

    const openEdit = (record: AgentMemory) => {
        setEditing(record);
        form.setFieldsValue({
            topic: record.topic,
            category: record.category || "other",
            situation: record.situation,
            lesson: record.lesson,
            source: record.source,
            steps: record.steps || [],
        });
        setEditorOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        const request = toRequest(values);
        if (!request.lesson && !(request.steps && request.steps.length)) {
            message.warning(text("请填写做法，或至少添加一步路线", "Add a lesson or at least one step"));
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await updateAgentMemory(editing.id, request);
                message.success(text("已保存", "Saved"));
            } else {
                await createAgentMemory(request);
                message.success(text("已添加，立刻对你的 Agent 生效", "Memory added and active for your Agent"));
            }
            setEditorOpen(false);
            await load();
        } catch (error) {
            message.error(localizedErrorMessage(error, "保存失败", "Could not save memory", locale));
        } finally {
            setSaving(false);
        }
    };

    const decide = async (record: AgentMemory, decision: "approve" | "reject") => {
        setBusyId(record.id);
        try {
            await decideAgentMemory(record.id, decision);
            message.success(decision === "approve" ? text("已批准，之后的会话会用到这条记忆", "Approved. Future conversations may use this memory.") : text("已拒绝，不会再注入会话", "Rejected. This memory will not be used."));
            await load();
        } catch (error) {
            message.error(localizedErrorMessage(error, "处理失败", "Could not update memory", locale));
        } finally {
            setBusyId(null);
        }
    };

    const remove = (record: AgentMemory) => {
        modal.confirm({
            title: locale === "en-US" ? `Delete memory "${record.topic}"?` : `删除记忆「${record.topic}」`,
            content: text("删除后不会再出现在你的 Agent 上下文里。确认删除？", "The Agent will no longer use this memory."),
            okText: text("删除", "Delete"),
            okButtonProps: { danger: true },
            onOk: async () => {
                await deleteAgentMemory(record.id);
                message.success(text("已删除", "Deleted"));
                await load();
            },
        });
    };

    const onExport = async () => {
        try {
            const bundle = await exportAgentMemories();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `agent-memories-${bundle.exportedAt.slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(url);
            message.success(locale === "en-US" ? `Exported ${bundle.memories.length} memories` : `已导出 ${bundle.memories.length} 条`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "导出失败", "Could not export memories", locale));
        }
    };

    const onImportFile = async (file: File) => {
        try {
            const parsed = JSON.parse(await file.text()) as AgentMemoryBundle;
            const result = await importAgentMemories(parsed);
            message.success(locale === "en-US" ? `${result.imported} imported, ${result.merged} merged, ${result.skipped} skipped` : `导入 ${result.imported} 条，合并 ${result.merged} 条，跳过 ${result.skipped} 条`);
            await load();
        } catch (error) {
            message.error(localizedErrorMessage(error, "导入失败，请确认是本产品导出的 JSON", "Import failed. Choose a JSON file exported by this app.", locale));
        }
    };

    const pendingCount = items.filter((item) => item.status === "pending").length;
    const statusFilters = STATUS_FILTERS.map((option) => ({
        ...option,
        label:
            option.value === "pending" && pendingCount
                ? locale === "en-US"
                    ? `Pending ${pendingCount}`
                    : `待审 ${pendingCount}`
                : locale === "en-US"
                  ? { all: "All", pending: "Pending", approved: "Approved", rejected: "Rejected" }[option.value]
                  : option.label,
    }));

    return (
        <div className={compact ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" : "flex flex-col gap-5"}>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                <SegmentedControl size="sm" ariaLabel={text("记忆状态", "Memory status")} value={status} options={statusFilters} onChange={setStatus} />
                <div className="ml-auto flex items-center gap-1">
                    <IconButton variant="ghost" size="sm" icon={Download} aria-label={text("导出记忆", "Export memories")} onClick={() => void onExport()} />
                    <IconButton variant="ghost" size="sm" icon={Upload} aria-label={text("导入记忆", "Import memories")} onClick={() => fileRef.current?.click()} />
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        {text("添加记忆", "Add memory")}
                    </Button>
                </div>
                <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void onImportFile(file);
                    }}
                />
            </div>

            {compact ? null : <AgentMemoryCompactCard onApplied={load} />}

            <div className={compact ? "thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto" : undefined}>
                {loading ? (
                    <div className="space-y-2" aria-busy="true" aria-live="polite">
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="h-[72px] animate-pulse rounded-2xl bg-surface-secondary" />
                        ))}
                    </div>
                ) : null}
                {!loading && items.length === 0 ? (
                    <WorkspaceState
                        compact
                        icon="empty"
                        className={compact ? "min-h-0 flex-1 py-8" : "min-h-[220px] py-10"}
                        title={status === "pending" ? text("没有待批准的记忆", "No memories awaiting approval") : text("还没有个人记忆", "No personal memories yet")}
                        description={
                            status === "pending"
                                ? text("Agent 跑通任务后会把可复用做法记到这里，等你点头。", "Reusable steps from Agent tasks will appear here for your approval.")
                                : text("手动添加立刻生效，也可以等 Agent 记下后再批准。", "Add a memory now or approve one suggested by your Agent.")
                        }
                        action={
                            status === "pending" ? undefined : (
                                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                                    {text("添加记忆", "Add memory")}
                                </Button>
                            )
                        }
                    />
                ) : null}
                {!loading && items.length ? (
                    <div className="space-y-2">
                        {items.map((record) => (
                            <article key={record.id} className="group rounded-2xl bg-surface-secondary/80 px-3.5 py-3 transition-[background,transform] duration-[var(--motion-state)] hover:bg-surface-hover motion-reduce:transition-none">
                                <div className="flex items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm font-medium text-foreground">{record.topic}</h3>
                                            <StatusBadge size="sm" tone={memoryStatusTone(record.status)} label={memoryStatusLabel(record.status, locale)} />
                                            <span className="text-[11px] text-muted-foreground">{memoryCategoryLabel(record.category, locale)}</span>
                                        </div>
                                        <p className="mt-1 text-caption leading-5 text-muted-foreground">{record.situation}</p>
                                        {record.lesson ? <p className="mt-1 text-caption leading-5 text-foreground/80">{record.lesson}</p> : null}
                                        {record.steps?.length ? (
                                            <ol className="mt-1.5 ml-4 list-decimal space-y-0.5 text-[11px] leading-5 text-muted-foreground">
                                                {record.steps.map((step, index) => (
                                                    <li key={`${record.id}-${index}`}>
                                                        <span className="font-medium text-foreground/80">{step.tool}</span>
                                                        {" — "}
                                                        {step.action}
                                                        {step.note ? <span className="text-foreground/45">{locale === "en-US" ? ` (${step.note})` : `（${step.note}）`}</span> : null}
                                                    </li>
                                                ))}
                                            </ol>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                        {record.status === "pending" ? (
                                            <>
                                                <Button size="small" type="primary" icon={<Check className="size-3.5" />} loading={busyId === record.id} onClick={() => void decide(record, "approve")}>
                                                    {text("批准", "Approve")}
                                                </Button>
                                                <Button size="small" icon={<X className="size-3.5" />} loading={busyId === record.id} onClick={() => void decide(record, "reject")}>
                                                    {text("拒绝", "Reject")}
                                                </Button>
                                            </>
                                        ) : null}
                                        <IconButton variant="ghost" size="sm" icon={Pencil} aria-label={locale === "en-US" ? `Edit ${record.topic}` : `编辑 ${record.topic}`} onClick={() => openEdit(record)} />
                                        <IconButton variant="danger" size="sm" icon={Trash2} aria-label={locale === "en-US" ? `Delete ${record.topic}` : `删除 ${record.topic}`} onClick={() => remove(record)} />
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : null}
            </div>

            {compact ? (
                <div className="shrink-0 border-t border-border/40 pt-3">
                    <AgentMemoryCompactCard compact onApplied={load} />
                </div>
            ) : null}

            <AppModal
                open={editorOpen}
                title={editing ? text("编辑记忆", "Edit memory") : text("添加记忆", "Add memory")}
                okText={editing ? text("保存", "Save") : text("添加", "Add")}
                confirmLoading={saving}
                onOk={() => void save()}
                onCancel={() => setEditorOpen(false)}
            >
                <Form form={form} layout="vertical" className="pt-2">
                    <Form.Item name="topic" label={text("主题", "Topic")} rules={[{ required: true, message: text("请填写主题", "Enter a topic") }]}>
                        <Input maxLength={120} placeholder={text("例如 canvas.snapshot-hash", "For example: canvas.snapshot-hash")} />
                    </Form.Item>
                    <Form.Item name="category" label={text("分类", "Category")} rules={[{ required: true, message: text("请选择分类", "Choose a category") }]}>
                        <Select options={AGENT_MEMORY_CATEGORIES.map((entry) => ({ value: entry.key, label: memoryCategoryLabel(entry.key, locale) }))} />
                    </Form.Item>
                    <Form.Item name="situation" label={text("适用场景", "When to use")} rules={[{ required: true, message: text("请填写适用场景", "Describe when to use this memory") }]}>
                        <Input maxLength={200} placeholder={text("什么情况下用这条记忆", "When should the Agent use this memory?")} />
                    </Form.Item>
                    <Form.Item name="lesson" label={text("做法", "Lesson")}>
                        <Input.TextArea rows={3} maxLength={400} placeholder={text("一句话说明该怎么做", "Describe what to do in one sentence")} />
                    </Form.Item>
                    <Form.Item name="source" label={text("来源（可选）", "Source (optional)")}>
                        <Input maxLength={200} />
                    </Form.Item>
                    <Form.List name="steps">
                        {(fields, { add, remove: removeStep }) => (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm">{text("路线步骤（可选）", "Steps (optional)")}</span>
                                    <Button size="small" onClick={() => add({ tool: "", action: "", note: "" })}>
                                        {text("加一步", "Add step")}
                                    </Button>
                                </div>
                                {fields.map((field) => (
                                    <Space key={field.key} className="flex w-full" align="start">
                                        <Form.Item {...field} name={[field.name, "tool"]} className="mb-0 flex-1">
                                            <Input placeholder={text("工具名", "Tool name")} />
                                        </Form.Item>
                                        <Form.Item {...field} name={[field.name, "action"]} className="mb-0 flex-1">
                                            <Input placeholder={text("做什么", "Action")} />
                                        </Form.Item>
                                        <Button type="text" danger onClick={() => removeStep(field.name)}>
                                            {text("删", "Remove")}
                                        </Button>
                                    </Space>
                                ))}
                            </div>
                        )}
                    </Form.List>
                </Form>
            </AppModal>
        </div>
    );
}
