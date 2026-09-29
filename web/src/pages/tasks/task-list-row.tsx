import { Button } from "antd";
import { IconButton } from "@/components/ui/base/buttons";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Eye, FileText, FolderKanban, Image as ImageIcon, Play, RotateCcw, Video } from "lucide-react";
import { useState } from "react";

import { MediaPreview } from "@/components/media-preview";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { formatTaskKind, generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "@/lib/generation-task-display";
import { useLocaleText } from "@/lib/i18n";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { formatModelName, getTaskCanvasContext, isTaskFailed, statusDotClassName, taskAttentionReason, TaskBilling, TaskDate } from "./task-shared";
import { TaskVideoThumbnail } from "./task-video-thumbnail";

export function TaskListRow({
    task,
    canvasById,
    projectNameById,
    effectiveConfig,
    creditsEnabled,
    actingId,
    onOpen,
    onRetry,
    onPreview,
}: {
    task: GenerationTask;
    canvasById: Map<string, { title: string; projectId?: string }>;
    projectNameById: Map<string, string>;
    effectiveConfig: AiConfig;
    creditsEnabled: boolean;
    actingId: string;
    onOpen: () => void;
    onRetry: () => void;
    onPreview: () => void;
}) {
    const { locale, text } = useLocaleText();
    const context = getTaskCanvasContext(task, canvasById, projectNameById, locale);
    const isActive = task.status === "queued" || task.status === "running";
    const isFailed = isTaskFailed(task);
    const retryDisabled = task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error);
    const stageLabel = generationTaskStageLabel(task, locale);
    const showsProgress = generationTaskShowsProgress(task);
    return (
        <article className={`product-collection-card task-record-row group${isFailed ? " is-attention" : ""}`}>
            <TaskPreviewThumbnail task={task} onOpen={onPreview} />
            <div className="task-record-main">
                <div className="task-record-heading">
                    <span className={`task-record-status ${isFailed ? "is-failed" : isActive ? "is-active" : "is-success"}`}>
                        <i className={statusDotClassName(task.status)} />
                        {generationTaskStatusLabel(task, locale)}
                    </span>
                    <button type="button" className="task-record-title" title={task.prompt} onClick={onOpen}>
                        {task.prompt || text("未命名任务", "Untitled task")}
                    </button>
                </div>
                <div className="task-record-meta">
                    <span>{formatTaskKind(task, locale)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatModelName(effectiveConfig, task, locale)}</span>
                    <span className="task-record-meta-canvas">
                        <FolderKanban className="size-3" />
                        {context.canvasName}
                        {context.projectName ? ` · ${context.projectName}` : ""}
                    </span>
                </div>
                {isActive && !showsProgress ? <p>{stageLabel}</p> : isActive ? (
                    <div className="task-record-progress" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                        <span>{stageLabel}</span>
                        <span>{task.progress || 0}%</span>
                        <i>
                            <b style={{ width: `${task.progress || 0}%` }} />
                        </i>
                    </div>
                ) : null}
                {isFailed ? (
                    <p className="task-record-error" title={task.error ? taskAttentionReason(task, locale) : undefined}>
                        {taskAttentionReason(task, locale)}
                    </p>
                ) : null}
            </div>
            <div className="task-record-date">
                <TaskDate value={task.createdAt} />
            </div>
            {creditsEnabled ? <TaskBilling billing={task.billing} /> : <span className="task-record-billing-empty" aria-hidden="true" />}
            <div className="task-record-actions">
                <Tooltip title={text("查看详情", "View details")}>
                    <IconButton size="sm" variant="ghost" icon={Eye} aria-label={text("查看详情", "View details")} onClick={onOpen} />
                </Tooltip>
                {isFailed ? (
                    <Tooltip title={retryDisabled ? text("内容审核失败，无法自动重试", "Content was rejected; automatic retry is unavailable") : task.canRecoverMedia ? text("重试保存，不重新生成", "Retry saving without regenerating") : text("重试任务", "Retry task")}>
                        <Button
                            type="text"
                            size="small"
                            icon={<RotateCcw className="size-3.5" />}
                            aria-label={task.canRecoverMedia ? text("重试保存", "Retry saving") : text("重试任务", "Retry task")}
                            loading={actingId === task.id}
                            disabled={retryDisabled}
                            onClick={onRetry}
                        />
                    </Tooltip>
                ) : null}
            </div>
        </article>
    );
}

function TaskPreviewThumbnail({ task, onOpen }: { task: GenerationTask; onOpen: () => void }) {
    const { text } = useLocaleText();
    const isVideo = task.previewKind === "video";
    const fallbackVideo = task.type.includes("video");
    const [unavailableUrl, setUnavailableUrl] = useState("");
    const thumbnailUrl = isVideo ? task.previewPosterUrl : task.previewUrl;
    const previewUnavailable = Boolean(thumbnailUrl && unavailableUrl === thumbnailUrl);
    if (!task.previewUrl) {
        const Icon = fallbackVideo ? Video : task.type.includes("image") ? ImageIcon : FileText;
        return (
            <span className="task-record-thumb">
                <Icon className="size-4" />
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={onOpen}
            disabled={previewUnavailable}
            className="task-record-thumb group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={previewUnavailable ? text("预览不可用，素材可能已删除", "Preview unavailable; the asset may have been deleted") : isVideo ? text("放大预览生成视频", "Preview generated video") : text("放大预览生成图片", "Preview generated image")}
            title={previewUnavailable ? text("预览不可用，素材可能已删除", "Preview unavailable; the asset may have been deleted") : undefined}
        >
            {thumbnailUrl ? <MediaPreview src={thumbnailUrl} kind="image" width={68} height={48} loading="lazy" className="h-full w-full object-cover" fallbackLabel={text("预览不可用", "Preview unavailable")} onUnavailable={() => setUnavailableUrl(thumbnailUrl)} /> : isVideo ? <TaskVideoThumbnail src={task.previewUrl} /> : <ImageIcon className="size-4" />}
            {!previewUnavailable ? (
                <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition-[background-color,opacity] duration-150 group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100">
                    {isVideo ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}
                </span>
            ) : null}
        </button>
    );
}
