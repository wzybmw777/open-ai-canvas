import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { useLocaleText } from "@/lib/i18n";

export type TaskStatusFilter = "all" | "failed" | "active" | "succeeded";

export type TaskStats = { total: number; today: number; active: number; succeeded: number; failed: number };

export function TaskStatusFilterBar({ stats, value, onChange }: { stats: TaskStats; value: TaskStatusFilter; onChange: (value: TaskStatusFilter) => void }) {
    const { text } = useLocaleText();
    const options = [
        { value: "all", label: text("全部", "All"), count: stats.total },
        { value: "active", label: text("运行中", "Active"), count: stats.active },
        { value: "succeeded", label: text("已完成", "Completed"), count: stats.succeeded },
        { value: "failed", label: text("失败/取消", "Failed / cancelled"), count: stats.failed },
    ] satisfies Array<{ value: TaskStatusFilter; label: string; count: number }>;

    return (
        <div className="task-status-filter">
            <span className="task-status-today">{text("今日生成", "Created today")} <strong>{stats.today}</strong></span>
            <SegmentedControl<TaskStatusFilter>
                size="sm"
                value={value}
                options={options.map((option) => ({
                    value: option.value,
                    label: (
                        <span>
                            {option.label}
                            <b>{option.count}</b>
                        </span>
                    ),
                }))}
                onChange={onChange}
            />
        </div>
    );
}
