import { lazy, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App } from "antd";
import { ArrowLeft, Plus } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router";

import { getProjectCore, getProjectOverview, getProjectUnitWorkspace, linkCanvasUnit, listProjectUnits } from "@/services/api/projects";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import type { ProjectDetail } from "@/services/api/projects";
import { localeText, localizedErrorMessage, useLocaleText } from "@/lib/i18n";

import { WorkflowChapterNavigator } from "./detail/workflow-chapter-navigator";

const ProjectAssetsView = lazy(() => import("./detail/assets"));
const ProjectCanvasesView = lazy(() => import("./detail/canvases"));
const ProjectChaptersView = lazy(() => import("./detail/chapters"));
const ProjectOverviewView = lazy(() => import("./detail/overview"));
const ProjectSettingsView = lazy(() => import("./detail/settings"));
const ProjectWorkflowView = lazy(() => import("./detail/workflow"));
const ProjectEditorView = lazy(() => import("./detail/editor"));

type DetailView = "overview" | "chapters" | "workflow" | "canvases" | "editor" | "assets" | "settings";

const views: Array<{ key: DetailView; label: string; english: string }> = [
    { key: "overview", label: "制作概览", english: "Overview" },
    { key: "chapters", label: "剧情章节", english: "Chapters" },
    { key: "workflow", label: "分镜制作", english: "Storyboard" },
    { key: "canvases", label: "项目画布", english: "Canvases" },
    { key: "editor", label: "剪辑成片", english: "Editor" },
    { key: "assets", label: "角色与资产", english: "Characters & assets" },
    { key: "settings", label: "项目设置", english: "Settings" },
];

export default function ProjectDetailPage() {
    const { locale, text } = useLocaleText();
    const { projectId = "", view, chapterId, unitId, stage } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const activeView: DetailView = unitId || view === "workflow" ? "workflow" : chapterId ? "chapters" : views.some((item) => item.key === view) ? view as DetailView : "overview";
    const coreQuery = useQuery({
        queryKey: ["project", projectId, "core"],
        queryFn: () => getProjectCore(projectId),
        enabled: Boolean(projectId),
        refetchOnMount: "always",
    });
    const unitsQuery = useQuery({ queryKey: ["project", projectId, "units"], queryFn: () => listProjectUnits(projectId), enabled: Boolean(projectId) });
    const units = unitsQuery.data?.units || [];
    const firstUnitId = units.slice().sort((left, right) => left.position - right.position)[0]?.id || "";
    const requestedUnitId = chapterId || unitId || "";
    const activeUnitId = units.some((unit) => unit.id === requestedUnitId) ? requestedUnitId : firstUnitId;
    const overviewQuery = useQuery({ queryKey: ["project", projectId, "overview"], queryFn: () => getProjectOverview(projectId), enabled: Boolean(projectId) && activeView === "overview" });
    const workspaceQuery = useQuery({
        queryKey: ["project", projectId, "unit-workspace", activeUnitId],
        queryFn: () => getProjectUnitWorkspace(projectId, activeUnitId),
        enabled: Boolean(projectId && activeUnitId) && (activeView === "chapters" || activeView === "workflow"),
        refetchInterval: (query) => (query.state.data?.tasks || []).some((task) => task.clientContext?.shotId && (task.status === "queued" || task.status === "running")) ? 2_000 : false,
    });
    const project = coreQuery.data?.project;
    const workspace = workspaceQuery.data;
    const detail: ProjectDetail | undefined = project ? {
        project,
        units: workspace?.unit ? units.map((unit) => unit.id === workspace.unit.id ? workspace.unit : unit) : units,
        canvases: [],
        canvasUnitLinks: [],
        unitCanvasCounts: unitsQuery.data?.canvasCounts || {},
        assets: workspace?.assets || [],
        assetFolders: [],
        workflows: workspace?.workflows || [],
        shots: workspace?.shots || [],
        shotRevisions: workspace?.shotRevisions || [],
        shotArtifacts: workspace?.shotArtifacts || [],
        shotReferences: workspace?.shotReferences || [],
        assetCandidates: workspace?.assetCandidates || [],
        tasks: workspace?.tasks || [],
    } : undefined;
    const refreshProject = () => { void queryClient.invalidateQueries({ queryKey: ["project", projectId] }); void queryClient.invalidateQueries({ queryKey: ["projects"] }); };
    const createCanvas = async () => {
        if (detail?.project.status === "archived") { message.warning(text("项目已归档，请先在项目设置中恢复", "Restore this archived project in Settings first")); return; }
        const activeChapterId = chapterId || sessionStorage.getItem(`project-active-chapter:${projectId}`) || "";
        const unit = activeView === "chapters"
            ? detail?.units.find((item) => item.id === activeChapterId) || detail?.units.slice().sort((left, right) => left.position - right.position)[0]
            : undefined;
        const shots = unit ? detail?.shots.filter((shot) => shot.unitId === unit.id) || [] : [];
        try {
            const [{ createCanvasProjectWithRemoteSync }, storyboard] = await Promise.all([
                import("@/services/user-data-sync"),
                unit && shots.length ? import("@/lib/canvas/project-chapter-storyboard") : Promise.resolve(null),
            ]);
            const seed = unit && shots.length ? storyboard?.upsertProjectChapterStoryboard([], [], { unit, shots }) : undefined;
            const initialContent = seed ? { nodes: seed.nodes, connections: seed.connections } : undefined;
            const title = unit ? `${unit.title} · ${shots.length ? text("分镜画布", "Storyboard canvas") : text("画布", "Canvas")}` : `${detail?.project.name || text("项目", "Project")} · ${text("新画布", "New canvas")}`;
            const { id, syncError } = await createCanvasProjectWithRemoteSync(title, projectId, initialContent);
            if (syncError) {
                message.warning(locale === "en-US" ? "Canvas saved locally. Project linking will be retried." : syncError instanceof Error ? `画布已保存在本地，项目关联稍后重试：${syncError.message}` : "画布已保存在本地，项目关联稍后重试");
                navigate(`/canvas/${id}`);
                return;
            }
            if (unit) {
                try {
                    await linkCanvasUnit(projectId, { canvasId: id, unitId: unit.id, role: "storyboard" });
                } catch (error) {
                    refreshProject();
                    message.error(locale === "en-US" ? "Canvas created, but could not link it to the chapter." : error instanceof Error ? `画布已创建，但章节关联失败：${error.message}` : "画布已创建，但章节关联失败");
                    return;
                }
            }
            refreshProject();
            message.success(unit && shots.length ? locale === "en-US" ? `Chapter canvas created with ${shots.length} storyboard shots` : `已创建章节画布并导入 ${shots.length} 个分镜` : unit ? text("章节画布已创建并关联", "Chapter canvas created and linked") : text("项目画布已创建", "Project canvas created"));
            navigate(`/canvas/${id}`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "画布创建失败", "Could not create canvas", locale));
        }
    };
    const chapterHref = detail ? projectChapterHref(detail.units, projectId, chapterId) : `/projects/${projectId}/chapters`;
    const workflowHref = detail ? projectWorkflowHref(detail.units, projectId, unitId, stage) : `/projects/${projectId}/workflow`;
    if (coreQuery.isLoading || unitsQuery.isLoading) return <WorkspacePage><WorkspaceLoadingState label={text("正在打开项目工作台", "Opening project workspace")} detail={text("读取项目与章节索引", "Loading project and chapters")} /></WorkspacePage>;
    if (coreQuery.isError || unitsQuery.isError || !detail) return <WorkspacePage><WorkspaceErrorState title={text("项目不可用", "Project unavailable")} description={text("项目不存在、已被删除，或当前账号没有访问权限。", "This project may have been deleted or you may not have access.")} actionLabel={text("返回项目中心", "Back to projects")} onRetry={() => navigate("/projects")} /></WorkspacePage>;
    if (!chapterId && !unitId && (!view || !views.some((item) => item.key === view))) return <Navigate to={`/projects/${projectId}/overview`} replace />;
    if (chapterId && !units.some((unit) => unit.id === chapterId)) return <Navigate to={firstUnitId ? `/projects/${projectId}/chapters/${firstUnitId}` : `/projects/${projectId}/chapters`} replace />;
    if (unitId && !units.some((unit) => unit.id === unitId)) return <Navigate to={firstUnitId ? `/projects/${projectId}/workflow/${firstUnitId}/${stage || "video"}` : `/projects/${projectId}/workflow`} replace />;
    if (activeView === "workflow" && !unitId && detail.units.length) return <Navigate to={`/projects/${projectId}/workflow/${detail.units.slice().sort((left, right) => left.position - right.position)[0].id}/video`} replace />;
    return (
        <WorkspacePage className="project-workbench-page !overflow-hidden" fluid>
            <div className="flex h-full min-h-0 flex-col">
                <ProjectWorkspaceHeader
                    detail={detail}
                    projectId={projectId}
                    activeView={activeView}
                    unitId={unitId}
                    stage={stage}
                    chapterHref={chapterHref}
                    workflowHref={workflowHref}
                    onCreateCanvas={createCanvas}
                />
                {detail.project.status === "archived" ? <Alert type="warning" showIcon banner message={text("项目已归档，恢复后才能创建画布和生成任务", "This project is archived. Restore it to create canvases and tasks.")} className="!border-x-0 !border-t-0" /> : null}
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div className={activeView === "chapters" || activeView === "workflow" || activeView === "editor" ? "min-h-0 flex-1" : "thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5 lg:px-8 lg:py-7"}>
                        <Suspense fallback={<WorkspaceLoadingState label={text("正在准备当前项目视图", "Preparing project view")} detail={text("只加载当前使用的工作区模块", "Loading the selected workspace")} />}>
                            <div className={activeView === "overview" ? "w-full" : activeView === "chapters" || activeView === "workflow" || activeView === "editor" ? "h-full w-full" : "w-full"}>
                                {activeView === "overview" ? overviewQuery.isLoading ? <WorkspaceLoadingState label={text("正在统计制作进度", "Loading production progress")} detail={text("只读取聚合数据，不加载全部镜头历史", "Loading project summary")} /> : overviewQuery.data ? <ProjectOverviewView detail={detail} overview={overviewQuery.data} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : <WorkspaceErrorState title={text("制作概览读取失败", "Could not load overview")} description={text("请稍后重试。", "Try again later.")} onRetry={() => void overviewQuery.refetch()} /> : null}
                                {activeView === "chapters" ? workspaceQuery.isLoading ? <WorkspaceLoadingState label={text("正在读取当前章节", "Loading chapter")} detail={text("正文与制作数据按章节加载", "Loading chapter content and production data")} /> : workspaceQuery.isError ? <WorkspaceErrorState title={text("章节读取失败", "Could not load chapter")} description={text("当前章节可能已被删除，或服务暂时不可用。", "The chapter may have been deleted or the service may be unavailable.")} onRetry={() => void workspaceQuery.refetch()} /> : <ProjectChaptersView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                {activeView === "workflow" ? workspaceQuery.isLoading ? <WorkspaceLoadingState label={text("正在读取当前章节分镜", "Loading storyboard")} detail={text("仅加载本章镜头、版本和产物", "Loading shots and versions for this chapter")} /> : workspaceQuery.isError ? <WorkspaceErrorState title={text("分镜工作区读取失败", "Could not load storyboard")} description={text("当前章节制作数据暂时不可用。", "Production data for this chapter is unavailable.")} onRetry={() => void workspaceQuery.refetch()} /> : <ProjectWorkflowView detail={detail} projectId={projectId} unitId={unitId || ""} stage={stage || "video"} /> : null}
                                {activeView === "canvases" ? <ProjectCanvasesView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                {activeView === "assets" ? <ProjectAssetsView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                {activeView === "settings" ? <ProjectSettingsView detail={detail} refreshProject={refreshProject} onCreateCanvas={createCanvas} /> : null}
                                {activeView === "editor" ? <ProjectEditorView detail={detail} /> : null}
                            </div>
                        </Suspense>
                    </div>
                </main>
            </div>
        </WorkspacePage>
    );
}

function ProjectWorkspaceHeader({ detail, projectId, activeView, unitId, stage, chapterHref, workflowHref, onCreateCanvas }: { detail: ProjectDetail; projectId: string; activeView: DetailView; unitId?: string; stage?: string; chapterHref: string; workflowHref: string; onCreateCanvas: () => void }) {
    const { locale, text } = useLocaleText();
    const archived = detail.project.status === "archived";
    const createCanvasLabel = activeView === "chapters" && detail.units.length ? text("新建当前章节画布", "New canvas for this chapter") : text("新建项目画布", "New project canvas");
    return (
        <header className="project-workspace-header">
            <div className="project-workspace-identity">
                <Link to="/projects" className="project-workspace-back" aria-label={text("返回项目列表", "Back to projects")}>
                    <ArrowLeft />
                    <span className="sr-only">{text("返回", "Back")}</span>
                </Link>
                <div className="project-workspace-title">
                    <h1 title={detail.project.name}>{detail.project.name}</h1>
                    <span className={`project-workspace-status ${archived ? "is-archived" : "is-active"}`}>{archived ? text("已归档", "Archived") : text("进行中", "Active")}</span>
                </div>
            </div>
            <nav className="project-workspace-tabs" aria-label={text("项目导航", "Project navigation")}>
                {views.map((item) => {
                    const active = item.key === activeView;
                    const href = item.key === "chapters" ? chapterHref : item.key === "workflow" ? workflowHref : `/projects/${projectId}/${item.key}`;
                    return (
                        <Link
                            key={item.key}
                            to={href}
                            aria-current={active ? "page" : undefined}
                            className={`project-workspace-tab ${active ? "is-active" : ""}`}
                        >
                            {localeText(item.label, item.english, locale)}
                        </Link>
                    );
                })}
            </nav>
            <div className="project-workspace-actions">
                {activeView === "workflow" ? (
                    <WorkflowChapterNavigator projectId={projectId} units={detail.units} unitId={unitId} stage={stage} />
                ) : (
                    <button type="button" onClick={onCreateCanvas} className="project-workspace-create" aria-label={createCanvasLabel} title={createCanvasLabel}>
                        <Plus />
                        <span>{text("新建画布", "New canvas")}</span>
                    </button>
                )}
            </div>
        </header>
    );
}

function projectWorkflowHref(units: Array<{ id: string; position: number }>, projectId: string, routeUnitId?: string, routeStage?: string) {
    const targetId = [routeUnitId, sessionStorage.getItem(`project-active-chapter:${projectId}`) || ""].find((id) => id && units.some((unit) => unit.id === id)) || units.slice().sort((left, right) => left.position - right.position)[0]?.id;
    return targetId ? `/projects/${projectId}/workflow/${targetId}/${routeStage || "video"}` : `/projects/${projectId}/workflow`;
}

function projectChapterHref(units: Array<{ id: string; position: number }>, projectId: string, routeChapterId?: string) {
    const rememberedId = sessionStorage.getItem(`project-active-chapter:${projectId}`) || "";
    const targetId = [routeChapterId, rememberedId].find((id) => id && units.some((unit) => unit.id === id)) || units.slice().sort((left, right) => left.position - right.position)[0]?.id;
    return targetId ? `/projects/${projectId}/chapters/${targetId}` : `/projects/${projectId}/chapters`;
}
