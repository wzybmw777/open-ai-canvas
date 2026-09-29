import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { App, Button, Drawer, Form, Input, Modal, Typography } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Bug, LayoutGrid, List, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { MediaPreview } from "@/components/media-preview";
import { PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { formatTaskKind, generationTaskStatusLabel, localizedOperationOptions, mediaDeliverySummary, operationOptions } from "@/lib/generation-task-display";
import { localeText, localizedErrorMessage, useLocaleText, type AppLocale } from "@/lib/i18n";
import { buildVideoOperationPrompt } from "@/lib/prompts";
import { backendProviderConfig, logicalModelIDForConfig } from "@/services/api/generation-task";

import { createGenerationTask, formatTaskLog, listGenerationTasks, listTaskLogs, queryFailedVideoProviderTask, queryGenerationTask, retryGenerationTask, recoverGenerationTaskMedia, type CreateTaskInput, type GenerationTask, type TaskLog } from "@/services/api/task-center";
import { syncGenerationTaskToCanvasStore } from "@/lib/canvas/canvas-generation-task-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { resolveModelRequestConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { listProjects, type ProjectSummary } from "@/services/api/projects";
import { TaskGridCard } from "./task-grid-card";
import { TaskGroupHeader, type TaskGroup } from "./task-group-header";
import { TaskListRow } from "./task-list-row";
import { formatModelName, getTaskCanvasContext, isTaskFailed, providerCancelStatusLabel, taskMediaKind } from "./task-shared";
import { TaskStatusFilterBar, type TaskStatusFilter } from "./task-status-filter";
import { Select } from "@/components/ui/base/select";

type TaskKindFilter = "all" | "text" | "image" | "video";
type TaskViewMode = "list" | "grid";

function preferenceKeys() {
    const userId = useUserStore.getState().user?.id ?? "anon";
    return { view: `task-center-view.${userId}`, group: `task-center-group.${userId}` };
}

function readTaskPreference(key: string, fallback: string): string {
    try {
        return window.localStorage.getItem(key) ?? fallback;
    } catch (error) {
        console.warn("读取任务中心偏好失败", error);
        return fallback;
    }
}

function writeTaskPreference(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch (error) {
        console.warn("保存任务中心偏好失败", error);
    }
}

function taskStatusFilter(value: string | null): TaskStatusFilter {
    return value === "failed" || value === "active" || value === "succeeded" ? value : "all";
}

export default function TasksPage() {
    const { message, modal } = App.useApp();
    const { locale, text } = useLocaleText();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const projects = useCanvasStore((state) => state.projects);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [form] = Form.useForm<CreateTaskInput & { operation: string }>();
    const { view: viewPreferenceKey, group: groupPreferenceKey } = preferenceKeys();
    const [domainProjects, setDomainProjects] = useState<ProjectSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [actingId, setActingId] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const statusFilter = taskStatusFilter(searchParams.get("status"));
    const setStatusFilter = (value: TaskStatusFilter) => {
        const next = new URLSearchParams(searchParams);
        next.set("status", value);
        setSearchParams(next, { replace: true });
    };
    const [keyword, setKeyword] = useState("");
    const [projectFilter, setProjectFilter] = useState("all");
    const [kindFilter, setKindFilter] = useState<TaskKindFilter>("all");
    const [modelFilter, setModelFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [viewMode, setViewMode] = useState<TaskViewMode>(() => (readTaskPreference(viewPreferenceKey, "list") === "grid" ? "grid" : "list"));
    const [groupEnabled, setGroupEnabled] = useState<boolean>(() => readTaskPreference(groupPreferenceKey, "0") === "1");
    const [retryingGroup, setRetryingGroup] = useState("");
    const [detailTask, setDetailTask] = useState<GenerationTask | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [taskLogs, setTaskLogs] = useState<TaskLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [mediaPreview, setMediaPreview] = useState<{ url: string; kind: "image" | "video"; title: string } | null>(null);
    const [tasks, setTasks] = useState<GenerationTask[]>([]);
    const syncedCanvasTaskIdsRef = useRef(new Set<string>());
    const tasksRef = useRef<GenerationTask[]>([]);
    const canvasById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
    const domainProjectNameById = useMemo(() => new Map(domainProjects.map((item) => [item.project.id, item.project.name])), [domainProjects]);
    const projectOptions = useMemo(() => projects.map((project) => {
        const projectName = project.projectId ? domainProjectNameById.get(project.projectId) : "";
        return { label: projectName ? `${project.title || localeText("未命名画布", "Untitled canvas", locale)} · ${projectName}` : project.title || localeText("未命名画布", "Untitled canvas", locale), value: project.id };
    }), [domainProjectNameById, locale, projects]);
    const modelOptions = useMemo(() => Array.from(new Set(tasks.map((task) => formatModelName(effectiveConfig, task, locale)).filter(Boolean))).sort((left, right) => left.localeCompare(right, locale)), [effectiveConfig, locale, tasks]);
    const filteredTasks = useMemo(() => tasks.filter((task) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "active") return task.status === "queued" || task.status === "running";
        if (statusFilter === "failed") return task.status === "failed" || task.status === "cancelled";
        if (statusFilter === "succeeded") return task.status === "succeeded";
        return false;
    }).filter((task) => {
        if (projectFilter !== "all" && task.projectId !== projectFilter) return false;
        if (kindFilter !== "all" && taskMediaKind(task) !== kindFilter) return false;
        if (modelFilter !== "all" && formatModelName(effectiveConfig, task) !== modelFilter) return false;
        const query = keyword.trim().toLowerCase();
        const context = getTaskCanvasContext(task, canvasById, domainProjectNameById, locale);
        return !query || `${task.prompt} ${task.model || ""} ${formatTaskKind(task, locale)} ${context.canvasName} ${context.projectName}`.toLowerCase().includes(query);
    }), [canvasById, domainProjectNameById, effectiveConfig, keyword, kindFilter, locale, modelFilter, projectFilter, statusFilter, tasks]);
    const visibleTasks = useMemo(() => filteredTasks.slice((page - 1) * pageSize, page * pageSize), [filteredTasks, page, pageSize]);
    const taskStats = useMemo(() => {
        let today = 0;
        let active = 0;
        let succeeded = 0;
        let failed = 0;
        const now = new Date();
        for (const task of tasks) {
            if (task.createdAt) {
                const created = new Date(task.createdAt);
                if (!Number.isNaN(created.getTime()) && created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth() && created.getDate() === now.getDate()) today += 1;
            }
            if (task.status === "queued" || task.status === "running") active += 1;
            else if (task.status === "succeeded") succeeded += 1;
            else if (task.status === "failed" || task.status === "cancelled") failed += 1;
        }
        return { total: tasks.length, today, active, succeeded, failed };
    }, [tasks]);
    const groupingActive = viewMode === "list" && groupEnabled;
    const visibleTaskGroups = useMemo(
        () => (groupingActive ? groupTasksByCanvas(filteredTasks, canvasById, domainProjectNameById, locale) : []),
        [canvasById, domainProjectNameById, filteredTasks, groupingActive, locale],
    );

    const changeViewMode = (mode: TaskViewMode) => {
        setViewMode(mode);
        writeTaskPreference(viewPreferenceKey, mode);
    };

    const changeGroupEnabled = (enabled: boolean) => {
        setGroupEnabled(enabled);
        writeTaskPreference(groupPreferenceKey, enabled ? "1" : "0");
    };

    const retryGroupTasks = async (key: string, items: GenerationTask[]) => {
        const retryable = items.filter((task) => isTaskFailed(task) && task.errorCode !== CONTENT_MODERATION_ERROR_CODE && !isContentModerationError(task.error));
        if (!retryable.length) return;
        setRetryingGroup(key);
        try {
            for (const task of retryable) {
                await runAction(task.id);
            }
        } finally {
            setRetryingGroup("");
        }
    };

    const renderTaskRow = (task: GenerationTask) => (
        <TaskListRow
            key={task.id}
            task={task}
            canvasById={canvasById}
            projectNameById={domainProjectNameById}
            effectiveConfig={effectiveConfig}
            creditsEnabled={creditsEnabled}
            actingId={actingId}
            onOpen={() => void openTaskDetail(task)}
            onRetry={() => void runAction(task.id)}
            onPreview={() => task.previewUrl && setMediaPreview({ url: task.previewUrl, kind: task.previewKind === "video" ? "video" : "image", title: task.prompt || formatTaskKind(task, locale) })}
        />
    );

    const renderTaskGridCard = (task: GenerationTask) => (
        <TaskGridCard
            key={task.id}
            task={task}
            actingId={actingId}
            onOpen={() => void openTaskDetail(task)}
            onRetry={() => void runAction(task.id)}
        />
    );

    useEffect(() => {
        if (!shortDramaEnabled) {
            setDomainProjects([]);
            return;
        }
        let cancelled = false;
        void listProjects()
            .then((result) => {
                if (!cancelled) setDomainProjects(result.projects);
            })
            .catch((error) => {
                if (cancelled) return;
                // 领域项目只是任务页的辅助筛选数据；读取失败不能阻断任务列表，但必须清空旧快照并留下可检索的诊断。
                setDomainProjects([]);
                console.warn("加载任务关联项目失败，已禁用本次项目筛选", error);
            });
        return () => {
            cancelled = true;
        };
    }, [shortDramaEnabled]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
        if (page > maxPage) setPage(maxPage);
    }, [filteredTasks.length, page, pageSize]);

    const syncCompletedCanvasTasks = useCallback(async (items: GenerationTask[]) => {
        const pendingTaskIds = new Set(
            useCanvasStore
                .getState()
                .projects.flatMap((project) => project.nodes)
                .filter((node) => node.metadata?.taskId && (node.metadata.status !== "success" || !node.metadata.content))
                .map((node) => node.metadata!.taskId!),
        );
        const candidates = items.filter((task) => task.status === "succeeded" && pendingTaskIds.has(task.id) && task.projectId && task.type.startsWith("canvas_") && !syncedCanvasTaskIdsRef.current.has(task.id));
        await Promise.all(
            candidates.map(async (task) => {
                syncedCanvasTaskIdsRef.current.add(task.id);
                try {
                    const detail = task.resultJson ? task : await queryGenerationTask(task.id);
                    await syncGenerationTaskToCanvasStore(detail);
                } catch {
                    syncedCanvasTaskIdsRef.current.delete(task.id);
                }
            }),
        );
    }, []);

    const loadTasks = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const next = await listGenerationTasks();
            setTasks((current) => reconcileTaskSummaries(current, next));
            void syncCompletedCanvasTasks(next);
            return next;
        } catch (error) {
            if (showLoading) message.error(localizedErrorMessage(error, "任务加载失败", "Could not load tasks", locale));
            return undefined;
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [locale, message, syncCompletedCanvasTasks]);

    const openTaskDetail = useCallback(
        async (task: GenerationTask) => {
            setDetailTask(task);
            setTaskLogs([]);
            setDetailLoading(true);
            setLogsLoading(true);
            try {
                const [detail, logs] = await Promise.all([queryGenerationTask(task.id), listTaskLogs(task.id)]);
                setDetailTask(detail);
                setTaskLogs(logs);
            } catch (error) {
                message.error(localizedErrorMessage(error, "任务详情加载失败", "Could not load task details", locale));
            } finally {
                setDetailLoading(false);
                setLogsLoading(false);
            }
        },
        [locale, message],
    );

    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        let stopped = false;
        let timer = 0;
        const poll = async (initial = false) => {
            const next = await loadTasks(initial);
            if (stopped) return;
            const items = next || tasksRef.current;
            const hasActiveTasks = items.some((task) => task.status === "queued" || task.status === "running");
            timer = window.setTimeout(() => void poll(false), document.hidden ? 60_000 : hasActiveTasks ? 10_000 : 60_000);
        };
        const handleVisibility = () => {
            if (document.hidden) return;
            window.clearTimeout(timer);
            void poll(false);
        };
        void poll(true);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [loadTasks]);

    const runAction = async (id: string) => {
        setActingId(id);
        try {
            const currentTask = await queryGenerationTask(id);
            const savingMedia = Boolean(currentTask.mediaStage);
            const next = currentTask.status === "queued" || currentTask.status === "running" || currentTask.status === "succeeded"
                ? currentTask
                : savingMedia ? await recoverGenerationTaskMedia(id) : await retryGenerationTask(id);
            setTasks((items) => items.map((item) => (item.id === id ? next : item)));
            setDetailTask((current) => (current?.id === id ? { ...current, ...next } : current));
            setStatusFilter("active");
            setPage(1);
            message.success(next.status === "succeeded" ? text("任务已完成", "Task completed") : savingMedia ? text("正在恢复作品保存，不会重新生成", "Retrying the save without regenerating") : text("任务已在队列中", "Task queued"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "操作失败", "Action failed", locale));
        } finally {
            setActingId("");
        }
    };

    const queryProviderTask = async (task: GenerationTask) => {
        setActingId(task.id);
        try {
            const result = await queryFailedVideoProviderTask(task.id);
            if (!result.recovered) {
                setTaskLogs(await listTaskLogs(task.id));
                message.info(`${text("上游任务仍在处理中", "Provider task is still processing")}${result.providerStatus ? ` (${result.providerStatus})` : ""}`);
                return;
            }
            setDetailTask(result.task);
            setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, ...result.task } : item)));
            setTaskLogs(await listTaskLogs(task.id));
            await syncGenerationTaskToCanvasStore(result.task);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            void loadTasks(false);
            if (result.billingSettled) message.success(text("已获取上游视频，任务已恢复并完成结算", "Video recovered and charges settled"));
            else message.warning(text("已获取上游视频，任务已恢复，计费状态待管理员核对", "Video recovered; billing requires administrator review"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "查询上游任务失败", "Could not check the provider task", locale));
        } finally {
            setActingId("");
        }
    };

    const submitTask = async () => {
        const values = await form.validateFields();
        setCreating(true);
        try {
            {
                const videoModel = values.model?.trim() || effectiveConfig.videoModel || effectiveConfig.model;
                if (values.operation !== "compare_versions" && !isAiConfigReady(effectiveConfig, videoModel)) {
                    message.error(text("请先在设置里配置可用的视频模型、Base URL 和 API Key", "Set up a video model, Base URL and API key in Settings first"));
                    return;
                }
                const requestConfig = resolveModelRequestConfig(effectiveConfig, videoModel);
                const task = await createGenerationTask({
                    projectId: values.projectId,
                    type: `video_${values.operation}`,
                    operation: values.operation,
                    prompt: values.prompt,
                    provider: values.operation === "compare_versions" ? "internal-agent" : "openai-compatible",
                    model: values.operation === "compare_versions" ? "version-router" : requestConfig.model,
					...(values.operation !== "compare_versions" && logicalModelIDForConfig(requestConfig) ? { logicalModelId: logicalModelIDForConfig(requestConfig) } : {}),
                    input: {
                        source: "tasks-page",
                        mode: values.operation === "compare_versions" ? "workflow" : "video",
                        prompt: buildVideoOperationPrompt(values.operation, values.prompt, operationOptions.find((item) => item.value === values.operation)?.label || "其他视频操作"),
                        config: values.operation === "compare_versions" ? undefined : backendProviderConfig(requestConfig),
                        metadata: { videoEditOperation: values.operation },
                    },
                });
                setTasks((items) => [task, ...items]);
            }
            setStatusFilter("active");
            setPage(1);
            setCreateOpen(false);
            form.resetFields();
            message.success(text("任务已创建", "Task created"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "任务创建失败", "Could not create task", locale));
        } finally {
            setCreating(false);
        }
    };

    return (
        <>
            <WorkspacePage grid className="library-page task-library-page">
                <div className="studio-band">
                    <PageHeader
                        title={text("创作历史", "Creation history")}
                        description={text("查看文本、图片和视频生成任务，跟踪进度并处理失败任务。", "Track text, image and video generation, and review failed tasks.")}
                        meta={<span className="app-projects-header-meta">{taskStats.total} {text("个任务", "tasks")}</span>}
                        actions={
                            <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
                                {text("新建任务", "New task")}
                            </Button>
                        }
                    />
                    <CollectionToolbar
                        active={Boolean(keyword || projectFilter !== "all" || kindFilter !== "all" || modelFilter !== "all" || statusFilter !== "all")}
                        onReset={() => { setKeyword(""); setProjectFilter("all"); setKindFilter("all"); setModelFilter("all"); setStatusFilter("all"); setPage(1); }}
                        trailing={(
                            <div className="flex flex-wrap items-center gap-2.5">
                                {viewMode === "list" ? (
                                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground/55">
                                        <Switch size="sm" checked={groupEnabled} onChange={changeGroupEnabled} />
                                        <span>{text("按画布分组", "Group by canvas")}</span>
                                    </label>
                                ) : null}
                                <div className="task-view-switch">
                                    <SegmentedControl<TaskViewMode>
                                        ariaLabel={text("任务视图", "Task view")}
                                        size="sm"
                                        value={viewMode}
                                        options={[
                                            { value: "list", icon: <List className="size-3.5" />, title: text("列表视图", "List view") },
                                            { value: "grid", icon: <LayoutGrid className="size-3.5" />, title: text("网格视图", "Grid view") },
                                        ]}
                                        onChange={changeViewMode}
                                    />
                                </div>
                            </div>
                        )}
                    >
                        <TaskStatusFilterBar stats={taskStats} value={statusFilter} onChange={(value) => { setStatusFilter(value); setPage(1); }} />
                        <Input id="task-search" name="taskSearch" allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder={text("搜索任务、模型或画布", "Search tasks, models or canvases")} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                        <Select className="w-full sm:w-48" value={projectFilter} onChange={(value) => { setProjectFilter(value); setPage(1); }} options={[{ label: text("全部画布", "All canvases"), value: "all" }, ...projectOptions]} />
                        <Select className="w-full sm:w-32" value={kindFilter} onChange={(value) => { setKindFilter(value as TaskKindFilter); setPage(1); }} options={[{ label: text("全部类型", "All types"), value: "all" }, { label: text("文本", "Text"), value: "text" }, { label: text("图片", "Image"), value: "image" }, { label: text("视频", "Video"), value: "video" }]} />
                        <Select className="w-full sm:w-44" value={modelFilter} onChange={(value) => { setModelFilter(value); setPage(1); }} options={[{ label: text("全部模型", "All models"), value: "all" }, ...modelOptions.map((model) => ({ label: model, value: model }))]} />
                    </CollectionToolbar>
                </div>

                <div className="collection-content task-collection-content">
                    {loading && !tasks.length ? <div className="library-loading-grid" aria-label={text("正在加载任务", "Loading tasks")}>{Array.from({ length: 8 }, (_, index) => <div key={index} className="library-skeleton" />)}</div> : null}
                    {!loading || tasks.length ? (
                        visibleTasks.length ? (
                            viewMode === "grid" ? (
                                <div className="task-grid-view">
                                    {visibleTasks.map(renderTaskGridCard)}
                                </div>
                            ) : groupingActive ? (
                                <div className="task-group-list">
                                    {visibleTaskGroups.map((group) => (
                                        <section key={group.key} className="task-group">
                                            <TaskGroupHeader group={group} retrying={retryingGroup === group.key} onRetryFailed={() => void retryGroupTasks(group.key, group.tasks)} />
                                            <div className="task-record-list">
                                                {group.tasks.map(renderTaskRow)}
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            ) : (
                                <div className="task-record-list">{visibleTasks.map(renderTaskRow)}</div>
                            )
                        ) : (
                            <WorkspaceState
                                compact
                                title={taskEmptyState(statusFilter, locale).title}
                                description={taskEmptyState(statusFilter, locale).description}
                                action={<Button className="library-primary-action" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>{text("新建任务", "New task")}</Button>}
                            />
                        )
                    ) : null}
                    {!groupingActive ? <PaginationBar current={page} pageSize={pageSize} total={filteredTasks.length} pageSizeOptions={[20, 50, 100]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} /> : null}
                </div>
            </WorkspacePage>
            <Modal className="library-modal" title={text("新建异步生成任务", "New generation task")} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitTask} confirmLoading={creating} okText={text("创建任务", "Create task")}>
                <Form form={form} layout="vertical" initialValues={{ operation: "text_to_video" }}>
                    <Form.Item name="operation" label={text("任务类型", "Task type")} rules={[{ required: true, message: text("请选择任务类型", "Select a task type") }]}>
                        <Select options={localizedOperationOptions(locale)} />
                    </Form.Item>
                    <Form.Item name="prompt" label={text("创作指令", "Prompt")} rules={[{ required: true, message: text("请输入创作指令", "Enter a prompt") }]}>
                        <Input.TextArea rows={5} placeholder={text("描述短剧、MV、TVC 或要执行的视频编辑操作", "Describe the story, music video, commercial or edit you want")} />
                    </Form.Item>
                    <Form.Item name="projectId" label={text("绑定画布", "Link canvas")}>
                        <Select allowClear showSearch optionFilterProp="label" options={projectOptions} placeholder={projectOptions.length ? text("可选，选择要绑定的画布", "Optional: select a canvas") : text("暂无本地画布", "No local canvases")} />
                    </Form.Item>
                    <Form.Item name="model" label={text("目标模型", "Target model")}>
                        <Input placeholder={text("可选，例如 seedance、kling、wan、nano-banana", "Optional, e.g. seedance, kling, wan or nano-banana")} />
                    </Form.Item>
                </Form>
            </Modal>
            <Drawer className="library-drawer" title={text("任务详情", "Task details")} open={Boolean(detailTask)} onClose={() => setDetailTask(null)} size="large" destroyOnHidden>
                {detailTask ? (
                    <div className="space-y-5">
                        <div className="task-detail-facts grid text-sm sm:grid-cols-2">
                            <InfoItem label={text("状态", "Status")} value={generationTaskStatusLabel(detailTask, locale)} />
                            {detailTask.mediaStage ? <InfoItem label={text("作品交付", "Result delivery")} value={mediaDeliverySummary(detailTask.status, detailTask.mediaStage, locale)} /> : null}
                            <InfoItem label={text("画布名称", "Canvas")} value={getTaskCanvasContext(detailTask, canvasById, domainProjectNameById, locale).canvasName} />
                            <InfoItem label={text("任务类型", "Task type")} value={formatTaskKind(detailTask, locale)} />
                            <InfoItem label={text("模型", "Model")} value={formatModelName(effectiveConfig, detailTask, locale)} />
                            <InfoItem label={text("尝试次数", "Attempts")} value={text(`第 ${detailTask.attempts || 1} 次`, `${detailTask.attempts || 1}`)} />
                            <InfoItem label={text("创建时间", "Created")} value={formatDate(detailTask.createdAt, locale)} />
                            <InfoItem label={text("开始时间", "Started")} value={formatDate(detailTask.startedAt, locale)} />
                            <InfoItem label={text("完成时间", "Completed")} value={formatDate(detailTask.completedAt, locale)} />
                            <InfoItem label={text("耗时", "Duration")} value={formatTaskDuration(detailTask, locale)} />
                            {detailTask.providerCancelStatus ? <InfoItem label={text("上游取消", "Provider cancellation")} value={providerCancelStatusLabel(detailTask, locale)} /> : null}
                            {detailTask.providerCancelRequestedAt ? <InfoItem label={text("请求取消时间", "Cancellation requested")} value={formatDate(detailTask.providerCancelRequestedAt, locale)} /> : null}
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                            {detailTask.canRecoverMedia ? <Button icon={<RefreshCw className="size-4" />} loading={actingId === detailTask.id} onClick={() => void runAction(detailTask.id)}>{text("重试保存", "Retry saving")}</Button> : null}
                            {canQueryProviderTask(detailTask) ? <Button icon={<RefreshCw className="size-4" />} loading={actingId === detailTask.id} onClick={() => void queryProviderTask(detailTask)}>{text("手动查询任务", "Check provider task")}</Button> : null}
                            {isTaskFailed(detailTask) ? <Button icon={<Bug className="size-4" />} onClick={() => navigate(`/settings?section=diagnostics&taskId=${encodeURIComponent(detailTask.id)}${detailTask.projectId ? `&projectId=${encodeURIComponent(detailTask.projectId)}` : ""}`)}>{text("导出诊断包", "Export diagnostics")}</Button> : null}
                        </div>
                        {detailTask.error ? <pre className="task-detail-error max-h-28 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs">{locale === "en-US" && /[\u3400-\u9fff]/.test(generationErrorMessage(detailTask.error)) ? text("生成失败，请查看任务日志", "Generation failed. Review the task logs.") : generationErrorMessage(detailTask.error)}</pre> : null}
                        <TaskResultMedia value={detailTask.resultJson} taskType={detailTask.type} />
                        <DetailBlock title={text("提示词", "Prompt")} value={detailLoading ? text("详情加载中...", "Loading details...") : detailTask.prompt || text("无", "None")} tall />
                        <TaskParameters inputJson={detailLoading ? undefined : detailTask.inputJson} />
                        <DetailBlock title={text("结果", "Result")} value={detailLoading ? text("详情加载中...", "Loading details...") : formatTaskJson(detailTask.resultJson, locale)} />
                        <div>
                            <Typography.Text strong>{text("日志", "Logs")}</Typography.Text>
                            <div className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                                {logsLoading ? text("日志加载中...", "Loading logs...") : taskLogs.length ? taskLogs.map((log) => `[${new Date(log.createdAt).toLocaleString(locale)}] ${log.level.toUpperCase()} ${formatTaskLog(log)}`).join("\n\n") : text("暂无日志", "No logs")}
                            </div>
                        </div>
                    </div>
                ) : null}
            </Drawer>
            <Modal
                title={<span className="block truncate pr-8">{mediaPreview?.title || text("生成结果预览", "Generated result preview")}</span>}
                open={Boolean(mediaPreview)}
                onCancel={() => setMediaPreview(null)}
                footer={null}
                centered
                width="min(1040px, calc(100vw - 32px))"
                destroyOnHidden
                className="library-modal task-media-preview-modal"
            >
                {mediaPreview ? (
                    <MediaPreview
                        src={mediaPreview.url}
                        kind={mediaPreview.kind}
                        alt={mediaPreview.title}
                        controls={mediaPreview.kind === "video"}
                        className="max-h-[76vh] w-full bg-black object-contain"
                        fallbackClassName="task-media-preview-unavailable"
                    />
                ) : null}
            </Modal>
        </>
    );
}

function canQueryProviderTask(task: GenerationTask) {
    return task.status === "failed" && !task.mediaStage && (task.type.startsWith("canvas_video") || task.type.startsWith("video_")) && Boolean(task.providerRequestId);
}

function reconcileTaskSummaries(current: GenerationTask[], next: GenerationTask[]) {
    if (current.length === 0) return next;
    const currentById = new Map(current.map((task) => [task.id, task]));
    let changed = false;
    const reconciled = next.map((task) => {
        const previous = currentById.get(task.id);
        if (previous?.updatedAt === task.updatedAt && previous.previewUrl === task.previewUrl && previous.previewPosterUrl === task.previewPosterUrl && previous.billing?.status === task.billing?.status && previous.billing?.amountMicrocredits === task.billing?.amountMicrocredits) return previous;
        changed = true;
        return task;
    });
    return changed ? reconciled : current;
}

function TaskResultMedia({ value, taskType }: { value?: string; taskType: string }) {
    const { text } = useLocaleText();
    const urls = resultMediaUrls(value);
    if (!urls.length) return null;
    return (
        <div>
            <Typography.Text strong>{text("生成结果", "Generated results")}</Typography.Text>
            <div className="mt-2 grid max-h-[360px] grid-cols-2 gap-2 overflow-auto rounded-lg bg-stone-950 p-2 md:grid-cols-3">
                {urls.map((url, index) => {
                    const isVideo = isVideoResult(url, taskType);
                    return (
                        <MediaPreview
                            key={`${url}-${index}`}
                            src={url}
                            kind={isVideo ? "video" : "image"}
                            alt={`${text("生成结果", "Generated result")} ${index + 1}`}
                            controls={isVideo}
                            className={isVideo ? "task-result-media is-video" : "task-result-media"}
                            fallbackClassName={isVideo ? "task-result-media is-video" : "task-result-media"}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function resultMediaUrls(value?: string) {
    if (!value) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        parsed = value;
    }
    const urls: string[] = [];
    const visit = (item: unknown, key = "") => {
        if (typeof item === "string") {
            const isInlineMedia = /^(data:image\/|data:video\/)/.test(item);
            const isMediaPath = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)(?:$|\?)/i.test(item);
            const isNamedMediaUrl = /^(https?:|blob:)/.test(item) && /(url|image|video|result|output|media)/i.test(key);
            if ((isInlineMedia || isMediaPath || isNamedMediaUrl) && !urls.includes(item)) urls.push(item);
            return;
        }
        if (Array.isArray(item)) return item.forEach((value) => visit(value, key));
        if (item && typeof item === "object") Object.entries(item).forEach(([field, value]) => visit(value, field));
    };
    visit(parsed);
    return urls.slice(0, 12);
}

function isVideoResult(value: string, taskType: string) {
    return value.startsWith("data:video/") || /\.(mp4|webm|mov)(?:$|\?)/i.test(value) || taskType.includes("video");
}

function groupTasksByCanvas(tasks: GenerationTask[], canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>, locale: AppLocale): TaskGroup[] {
    const groups: TaskGroup[] = [];
    const byKey = new Map<string, TaskGroup>();
    for (const task of tasks) {
        const context = getTaskCanvasContext(task, canvasById, projectNameById, locale);
        const key = `${context.projectName}\u0000${context.canvasName}`;
        let group = byKey.get(key);
        if (!group) {
            group = { key, title: context.canvasName, projectName: context.projectName, tasks: [] };
            byKey.set(key, group);
            groups.push(group);
        }
        group.tasks.push(task);
    }
    return groups;
}

function taskEmptyState(status: TaskStatusFilter, locale: AppLocale) {
    if (status === "all") return { title: localeText("还没有任务", "No tasks yet", locale), description: localeText("新提交的生成会在这里显示状态和实时进度。", "New generations will appear here with their status and progress.", locale) };
    if (status === "active") return { title: localeText("没有运行中的任务", "No active tasks", locale), description: localeText("新提交的生成会在这里显示排队状态和实时进度。", "Queued and running generations will appear here.", locale) };
    if (status === "succeeded") return { title: localeText("还没有已完成任务", "No completed tasks", locale), description: localeText("生成成功后，结果预览和执行记录会保留在这里。", "Completed results and execution history will appear here.", locale) };
    return { title: localeText("没有失败或取消的任务", "No failed or cancelled tasks", locale), description: localeText("失败或取消的生成会出现在这里，并提供原因和可用操作。", "Failures and cancellations will appear here with their reasons and available actions.", locale) };
}

function formatDate(value: string | undefined, locale: AppLocale) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(locale);
}

function formatTaskDuration(task: GenerationTask, locale: AppLocale) {
    if (!task.createdAt) return "-";
    const start = new Date(task.startedAt || task.createdAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : task.status === "queued" || task.status === "running" ? Date.now() : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
    const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? localeText(`${minutes}分 ${seconds}秒`, `${minutes}m ${seconds}s`, locale) : localeText(`${seconds}秒`, `${seconds}s`, locale);
}

function InfoItem({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
    return (
        <div className="task-detail-fact min-w-0 px-3 py-2.5">
            <Typography.Text type="secondary" className="block text-xs">
                {label}
            </Typography.Text>
            <Typography.Text className={`block text-sm ${wrap ? "whitespace-pre-wrap break-words" : "truncate"}`} title={value}>
                {value}
            </Typography.Text>
        </div>
    );
}

function DetailBlock({ title, value, tall = false }: { title: string; value: string; tall?: boolean }) {
    return (
        <div>
            <Typography.Text strong>{title}</Typography.Text>
            <pre className={`mt-2 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100 ${tall ? "h-40 whitespace-pre-wrap break-words" : "max-h-60"}`}>{value}</pre>
        </div>
    );
}

function TaskParameters({ inputJson }: { inputJson?: string }) {
    const { locale, text } = useLocaleText();
    const fields = taskParameterFields(inputJson, locale);
    return (
        <div>
            <Typography.Text strong>{text("参数", "Parameters")}</Typography.Text>
            {fields.length ? (
                <div className="task-detail-facts mt-2 grid text-sm sm:grid-cols-2">
                    {fields.map((field) => <InfoItem key={field.label} label={field.label} value={field.value} wrap />)}
                </div>
            ) : (
                <div className="mt-2 rounded-md bg-foreground/[.04] px-3 py-3 text-sm text-foreground/50">{text("暂无参数记录", "No parameters recorded")}</div>
            )}
        </div>
    );
}

function taskParameterFields(inputJson: string | undefined, locale: AppLocale) {
    const input = parseTaskInput(inputJson);
    if (!input) return [];
    const config = asRecord(input.config);
    const fields: Array<{ label: string; value: string }> = [];
    const add = (label: string, value: unknown) => {
        const text = formatParameterValue(value);
        if (text) fields.push({ label, value: text });
    };

    add(localeText("模式", "Mode", locale), input.mode);
    add(localeText("尺寸 / 比例", "Size / ratio", locale), config.size);
    add(localeText("分辨率", "Resolution", locale), config.vquality || config.quality);
    add(localeText("时长", "Duration", locale), config.videoSeconds === undefined ? undefined : localeText(`${config.videoSeconds} 秒`, `${config.videoSeconds} s`, locale));
    add(localeText("生成数量", "Count", locale), config.count);
    add(localeText("生成声音", "Generate audio", locale), booleanParameter(config.videoGenerateAudio, locale));
    add(localeText("水印", "Watermark", locale), booleanParameter(config.videoWatermark, locale));
    add(localeText("音色", "Voice", locale), config.audioVoice);
    add(localeText("音频格式", "Audio format", locale), config.audioFormat);
    add(localeText("音频速度", "Audio speed", locale), config.audioSpeed);

    add(localeText("参考图片", "Reference images", locale), formatReferenceList(input.referenceImages, localeText("图片", "Image", locale), locale));
    add(localeText("参考视频", "Reference videos", locale), formatReferenceList(input.referenceVideos, localeText("视频", "Video", locale), locale));
    add(localeText("参考音频", "Reference audio", locale), formatReferenceList(input.referenceAudios, localeText("音频", "Audio", locale), locale));
    add(localeText("遮罩图片", "Mask image", locale), formatReferenceList(input.mask ? [input.mask] : [], localeText("遮罩", "Mask", locale), locale));
    return fields;
}

function parseTaskInput(value?: string): Record<string, unknown> | null {
    if (!value) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        return asRecord(parsed);
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatParameterValue(value: unknown) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
}

function booleanParameter(value: unknown, locale: AppLocale) {
    if (value === true || value === "true") return localeText("是", "Yes", locale);
    if (value === false || value === "false") return localeText("否", "No", locale);
    return undefined;
}

function formatReferenceList(value: unknown, kind: string, locale: AppLocale) {
    if (!Array.isArray(value) || !value.length) return localeText("无", "None", locale);
    return value.map((item, index) => {
        const reference = asRecord(item);
        const name = typeof reference.name === "string" && reference.name.trim() && !/^https?:|^data:|^blob:/i.test(reference.name) ? reference.name.trim() : `${kind}${locale === "en-US" ? " " : ""}${index + 1}`;
        const dimensions = typeof reference.width === "number" && typeof reference.height === "number" ? `${reference.width}×${reference.height}` : "";
        const duration = typeof reference.durationMs === "number" && reference.durationMs > 0 ? `${Math.round(reference.durationMs / 100) / 10}s` : "";
        const details = [dimensions, duration].filter(Boolean).join(locale === "en-US" ? ", " : "，");
        return details ? localeText(`${name}（${details}）`, `${name} (${details})`, locale) : name;
    }).join(locale === "en-US" ? ", " : "、");
}

function formatTaskJson(value: string | undefined, locale: AppLocale) {
    if (!value) return localeText("无", "None", locale);
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}
