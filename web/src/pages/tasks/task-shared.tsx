import { Coins } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { mediaDeliverySummary } from "@/lib/generation-task-display";
import { localeText, useLocaleText, type AppLocale } from "@/lib/i18n";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";

export function getTaskCanvasContext(task: GenerationTask, canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>, locale: AppLocale = "zh-CN") {
    if (!task.projectId) return { canvasName: localeText("未绑定画布", "No canvas linked", locale), projectName: "" };
    const canvas = canvasById.get(task.projectId);
    if (canvas) return { canvasName: canvas.title || localeText("未命名画布", "Untitled canvas", locale), projectName: canvas.projectId ? projectNameById.get(canvas.projectId) || "" : "" };
    const projectName = projectNameById.get(task.projectId);
    return projectName ? { canvasName: localeText("项目级任务", "Project task", locale), projectName } : { canvasName: localeText("画布已移除", "Canvas removed", locale), projectName: "" };
}

export function isTaskFailed(task: GenerationTask) {
    return task.status === "failed" || task.status === "cancelled";
}

export function taskAttentionReason(task: GenerationTask, locale: AppLocale = "zh-CN") {
    if (task.status === "cancelled") return providerCancelStatusLabel(task, locale);
    if (task.mediaStage) return mediaDeliverySummary(task.status, task.mediaStage, locale);
    if (task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)) return localeText("内容审核未通过，请修改输入后新建任务", "Content was rejected. Change the input and create a new task.", locale);
    if (task.error) {
        const detail = generationErrorMessage(task.error);
        return locale === "en-US" && /[\u3400-\u9fff]/.test(detail) ? "Generation failed. Open the details to review the error." : detail;
    }
    return localeText(task.stage || "生成失败，打开详情查看原因", "Generation failed. Open the details for more information.", locale);
}

export function providerCancelStatusLabel(task: GenerationTask, locale: AppLocale = "zh-CN") {
    if (task.providerCancelStatus === "requested") return localeText("已请求上游取消，正在等待确认", "Cancellation requested; awaiting confirmation", locale);
    if (task.providerCancelStatus === "confirmed") return localeText("上游已确认取消，积分已退回", "Cancelled by provider; credits refunded", locale);
    if (task.providerCancelStatus === "uncertain") {
        if (task.billing?.status === "settled") return localeText("上游未能取消，费用已结算", "Provider could not cancel; charges settled", locale);
        if (task.billing?.status === "refunded") return localeText("上游取消结果未确认，积分已退回", "Cancellation unconfirmed; credits refunded", locale);
        return locale === "en-US" ? "Cancellation unconfirmed; charges need review" : task.providerCancelError || "上游无法确认取消，费用待核对";
    }
    return task.billing?.status === "refunded" ? localeText("任务在调用上游前取消，积分已退回", "Cancelled before submission; credits refunded", locale) : localeText("任务已取消，可按原输入重新提交", "Task cancelled. You can submit it again.", locale);
}

export function statusDotClassName(status: TaskStatus) {
    if (status === "succeeded") return "task-record-dot is-success";
    if (status === "running") return "task-record-dot is-active is-pulsing";
    if (status === "queued") return "task-record-dot is-queued";
    if (status === "failed") return "task-record-dot is-failed";
    return "task-record-dot is-idle";
}

export function taskMediaKind(task: GenerationTask): "text" | "image" | "video" {
    const value = `${task.type} ${task.operation || ""}`.toLowerCase();
    if (value.includes("video") || value.includes("视频")) return "video";
    if (value.includes("image") || value.includes("图片") || value.includes("画面")) return "image";
    return "text";
}

export function TaskDate({ value }: { value?: string }) {
    const { locale } = useLocaleText();
    if (!value) return <span className="text-xs text-foreground/38">-</span>;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return <span className="text-xs text-foreground/38">-</span>;
    const compact = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString(locale === "en-US" ? "en-US" : "en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    return (
        <time className="task-record-date-value" dateTime={date.toISOString()} title={date.toLocaleString(locale)}>
            {compact}
        </time>
    );
}

export function TaskBilling({ billing }: { billing?: GenerationTask["billing"] }) {
    const { text } = useLocaleText();
    if (!billing) return <span className="task-record-billing-empty text-xs text-foreground/30">-</span>;
    const amount = formatCredits(billing.amountMicrocredits);
    const note = billing.status === "settled" ? text("已结算", "Settled") : billing.status === "refunded" ? text("已退回", "Refunded") : billing.status === "uncertain" ? text("待核对", "Review") : text("预计", "Estimated");
    return (
        <div className={`task-record-billing ${billing.status === "uncertain" ? "is-uncertain" : ""}`} title={`${text("积分", "Credits")}: ${note}`}>
            <Coins className="size-4" />
            <span>
                <strong>{amount}</strong>
                <small>{note}</small>
            </span>
        </div>
    );
}

export function formatModelName(config: AiConfig, task: GenerationTask, locale: AppLocale = "zh-CN") {
    const raw = (task.model || task.provider || "").trim();
    const model = raw.includes("::") ? raw.split("::").pop()?.trim() || raw : raw;

    // 工作流名称是任务快照，不属于模型渠道，不能交给模型展示名解析器再次映射成“系统模型”。
    if (task.provider === "runninghub") return raw || localeText("工作流", "Workflow", locale);
    if (!model) return localeText("工作流", "Workflow", locale);
    if (model === "version-router") return localeText("版本对比工作流", "Version comparison", locale);
    if (model === "workflow-router") return localeText("工作流路由", "Workflow router", locale);
    if (model === "internal-agent") return localeText("内置工作流", "Built-in workflow", locale);
    if (model === "openai-compatible") return localeText("OpenAI 兼容接口", "OpenAI-compatible API", locale);
    return modelDisplayName(config, raw);
}
