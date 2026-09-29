import { FolderKanban, RotateCcw } from "lucide-react";

import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { useLocaleText } from "@/lib/i18n";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed } from "./task-shared";

export type TaskGroup = { key: string; title: string; projectName: string; tasks: GenerationTask[] };

export function TaskGroupHeader({ group, retrying = false, onRetryFailed }: { group: TaskGroup; retrying?: boolean; onRetryFailed: () => void }) {
    const { text } = useLocaleText();
    const succeeded = group.tasks.filter((task) => task.status === "succeeded").length;
    const active = group.tasks.filter((task) => task.status === "queued" || task.status === "running").length;
    const failed = group.tasks.filter((task) => isTaskFailed(task) && task.errorCode !== CONTENT_MODERATION_ERROR_CODE && !isContentModerationError(task.error)).length;
    const title = group.projectName ? `${group.title} · ${group.projectName}` : group.title;
    return (
        <div className="task-group-head">
            <span className="task-group-ic">
                <FolderKanban />
            </span>
            <div className="min-w-0">
                <div className="task-group-name">
                    <span>{title}</span>
                    <span className="task-group-count">{text(`共 ${group.tasks.length} 项 · 完成 ${succeeded}`, `${group.tasks.length} tasks · ${succeeded} completed`)}</span>
                </div>
                <span className="task-group-sub">
                    {active ? (
                        <span>
                            {active} {text("运行中", "active")}
                        </span>
                    ) : null}
                    {active && failed ? <span aria-hidden="true"> · </span> : null}
                    {failed ? (
                        <b className="is-bad">
                            {failed} {text("失败", "failed")}
                        </b>
                    ) : null}
                    {(active || failed) && succeeded ? <span aria-hidden="true"> · </span> : null}
                    {succeeded ? (
                        <span>
                            {succeeded} {text("已完成", "completed")}
                        </span>
                    ) : null}
                    {!active && !failed && !succeeded ? text("暂无进行中的任务", "No active tasks") : null}
                </span>
            </div>
            {failed ? (
                <button type="button" className="task-group-reset" disabled={retrying} onClick={onRetryFailed}>
                    <RotateCcw className={retrying ? "animate-spin" : undefined} />
                    {retrying ? text("重试中...", "Retrying...") : text("重试失败任务", "Retry failed tasks")}
                </button>
            ) : null}
        </div>
    );
}
