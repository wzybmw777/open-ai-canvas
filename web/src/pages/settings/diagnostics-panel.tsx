import { App, Button, Input } from "antd";
import { Select } from "@/components/ui/base/select";
import { Activity, CheckCircle2, Clock3, Download, FileText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { exportDiagnosticBundle, downloadDiagnosticBundle, previewDiagnosticBundle, type DiagnosticExportInput, type DiagnosticPreview } from "@/services/diagnostics/diagnostics-api";
import { getClientDiagnosticEvents, getDiagnosticRuntime } from "@/services/diagnostics/client-diagnostics";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";

type DiagnosticsPanelProps = {
    taskId?: string;
    projectId?: string;
};

type DiagnosticRange = "15m" | "30m" | "1h" | "24h";

const rangeOptions: { value: DiagnosticRange; label: string }[] = [
    { value: "15m", label: "最近 15 分钟" },
    { value: "30m", label: "最近 30 分钟" },
    { value: "1h", label: "最近 1 小时" },
    { value: "24h", label: "最近 24 小时" },
];

export default function DiagnosticsPanel({ taskId, projectId }: DiagnosticsPanelProps) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const [range, setRange] = useState<DiagnosticRange>("30m");
    const [description, setDescription] = useState("");
    const [preview, setPreview] = useState<DiagnosticPreview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [bundleId, setBundleId] = useState("");

    useEffect(() => {
        let cancelled = false;
        setLoadingPreview(true);
        void previewDiagnosticBundle(buildInput(range, undefined, taskId, projectId))
            .then((result) => {
                if (!cancelled) setPreview(result);
            })
            .catch(() => {
                if (!cancelled) setPreview(null);
            })
            .finally(() => {
                if (!cancelled) setLoadingPreview(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, range, taskId]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const download = await exportDiagnosticBundle(buildInput(range, description, taskId, projectId));
            downloadDiagnosticBundle(download);
            setBundleId(download.bundleId);
            message.success(text("诊断包已下载，请连同诊断编号提交给支持人员", "Diagnostic bundle downloaded. Send it with its ID to support."));
        } catch (error) {
            message.error(localizedErrorMessage(error, "导出诊断包失败", "Could not export diagnostic bundle", locale));
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="settings-pane diagnostics-page">
            <div className="settings-section max-w-4xl pb-8">
                <header className="border-b border-border/60 pb-6 pt-1">
                    <div className="mb-3 flex items-center gap-2 text-[var(--fs-tiny)] font-semibold tracking-[0.12em] text-foreground/42">
                        <span className="h-px w-6 bg-[var(--workspace-accent)]" aria-hidden="true" />
                        <span>{text("排障工具", "Troubleshooting")}</span>
                    </div>
                    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.72fr)] md:items-end md:gap-10">
                        <div className="min-w-0">
                            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">{text("问题诊断", "Diagnostics")}</h2>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/55">{text("遇到报错、任务失败或生成卡住时，导出一份给开发人员排查。", "Export a bundle when an error, failed task, or stalled generation needs investigation.")}</p>
                        </div>
                        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[.06] px-3.5 py-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/[.12] text-emerald-600 dark:text-emerald-400">
                                <ShieldCheck className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground/85">{text("默认已脱敏", "Sensitive data excluded")}</div>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">{text("不包含 API Key、Cookie、完整提示词或原始媒体。", "Excludes API keys, cookies, full prompts, and original media.")}</p>
                            </div>
                        </div>
                    </div>
                </header>

                <div className="mt-6 space-y-4">
                    <section className="rounded-xl border border-border/70 bg-background/55 p-4 sm:p-5" aria-labelledby="diagnostic-window-heading">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/55 pb-4">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
                                    <Clock3 className="size-4 text-foreground/55" strokeWidth={1.8} aria-hidden="true" />
                                    <h3 id="diagnostic-window-heading">{text("收集范围", "Collection window")}</h3>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/48">{text("选择问题发生前后的日志时间窗口。", "Choose the time window around the issue.")}</p>
                            </div>
                            <span className="rounded-full bg-foreground/[.045] px-2.5 py-1 text-[var(--fs-tiny)] font-medium text-foreground/48">{text("最长 24 小时", "Up to 24 hours")}</span>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,230px)_minmax(0,1fr)] md:items-end">
                            <label className="block">
                                <span className="mb-2 block text-xs font-semibold text-foreground/65">{text("时间范围", "Time range")}</span>
                                <Select
                                    ariaLabel={text("时间范围", "Time range")}
                                    className="w-full"
                                    value={range}
                                    options={rangeOptions.map((option) => ({
                                        ...option,
                                        label: locale === "en-US" ? ({ "15m": "Last 15 minutes", "30m": "Last 30 minutes", "1h": "Last hour", "24h": "Last 24 hours" } as Record<DiagnosticRange, string>)[option.value] : option.label,
                                    }))}
                                    onChange={(value) => {
                                        const next = rangeOptions.find((option) => option.value === value)?.value;
                                        if (next) setRange(next);
                                    }}
                                />
                            </label>
                            <div className="rounded-lg border border-border/55 bg-foreground/[.025] px-3.5 py-3" aria-live="polite">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground/78">
                                    <Activity className="size-4 text-emerald-500" strokeWidth={1.8} aria-hidden="true" />
                                    <span>{text("当前账号的可用记录", "Records available for this account")}</span>
                                </div>
                                <div className="mt-3 grid grid-cols-3 divide-x divide-border/55">
                                    <DiagnosticMetric label={text("前端事件", "Client events")} value={loadingPreview ? text("读取中", "Loading") : text("最多 500", "Up to 500")} />
                                    <DiagnosticMetric label={text("任务", "Tasks")} value={loadingPreview ? text("读取中", "Loading") : preview ? String(preview.taskCount) : text("待统计", "Pending")} />
                                    <DiagnosticMetric label={text("上游调用", "Provider calls")} value={loadingPreview ? text("读取中", "Loading") : preview ? String(preview.apiCallCount) : text("待统计", "Pending")} />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-xl border border-border/70 bg-background/55 p-4 sm:p-5" aria-labelledby="diagnostic-description-heading">
                        <div className="flex items-start gap-2">
                            <FileText className="mt-0.5 size-4 text-foreground/55" strokeWidth={1.8} aria-hidden="true" />
                            <div>
                                <div className="flex items-center gap-2 text-sm font-semibold text-foreground/85">
                                    <h3 id="diagnostic-description-heading">{text("问题描述", "Issue description")}</h3>
                                    <span className="rounded-full bg-foreground/[.045] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/42">{text("可选", "Optional")}</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/48">{text("用一句话说明现象，帮助开发人员更快定位。", "Describe the issue briefly to help support investigate.")}</p>
                            </div>
                        </div>
                        <label className="mt-4 block" htmlFor="diagnostic-description">
                            <span className="sr-only">{text("遇到了什么问题？", "What happened?")}</span>
                            <Input.TextArea
                                id="diagnostic-description"
                                rows={4}
                                maxLength={1000}
                                showCount
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                placeholder={text("例如：点击生成后一直显示处理中，刷新页面也没有结果。", "For example: Generation stayed in progress after refreshing the page.")}
                            />
                        </label>
                    </section>
                </div>

                <footer className="mt-5 flex flex-col-reverse gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-md text-xs leading-5 text-foreground/48">{text("下载后请把 ZIP 文件和诊断编号一起提交。诊断包不会自动上传到服务器。", "Send the ZIP file and diagnostic ID to support. The bundle is not uploaded automatically.")}</p>
                    <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                        {bundleId ? (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[.06] px-2.5 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300" role="status">
                                <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
                                {text("诊断编号：", "Diagnostic ID: ")}
                                {bundleId}
                            </span>
                        ) : null}
                        <Button size="large" type="primary" icon={<Download className="size-4" strokeWidth={2} />} loading={exporting} onClick={() => void handleExport()}>
                            {text("导出诊断包", "Export diagnostic bundle")}
                        </Button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 px-3 first:pl-0 last:pr-0">
            <div className="truncate text-[var(--fs-tiny)] text-foreground/45">{label}</div>
            <div className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground/78">{value}</div>
        </div>
    );
}

function buildInput(range: DiagnosticRange, description: string | undefined, taskId?: string, projectId?: string): DiagnosticExportInput {
    const to = new Date();
    const from = new Date(to.getTime() - rangeMilliseconds(range));
    return {
        from: from.toISOString(),
        to: to.toISOString(),
        taskId: taskId || undefined,
        projectId: projectId || undefined,
        description: description || undefined,
        runtime: getDiagnosticRuntime(),
        clientEvents: getClientDiagnosticEvents({ from, to }),
    };
}

function rangeMilliseconds(range: DiagnosticRange) {
    switch (range) {
        case "15m":
            return 15 * 60 * 1000;
        case "1h":
            return 60 * 60 * 1000;
        case "24h":
            return 24 * 60 * 60 * 1000;
        default:
            return 30 * 60 * 1000;
    }
}
