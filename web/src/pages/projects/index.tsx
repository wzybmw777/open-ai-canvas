import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal } from "antd";
import { ArrowRight, BookOpenText, FileText, FolderKanban, Images, LayoutGrid, Palette, Plus, Search } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { CanvasStylePickerModal, resolveCanvasStylePreset, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { resourceFileUrl } from "@/services/api/resources";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { createProject, deleteProject, listProjects, type ProjectSummary } from "@/services/api/projects";

import { sourceTypeLabel } from "./detail/shared";
import { Select } from "@/components/ui/base/select";
import { localeText, localizedErrorMessage, useLocaleText } from "@/lib/i18n";

type ProjectForm = { name: string; aspectRatio: string; sourceType: string };

export default function ProjectsPage() {
    const { locale, text } = useLocaleText();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const [createForm] = Form.useForm<ProjectForm>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const [createSource, setCreateSource] = useState<"blank" | "novel" | "text">("blank");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const createOpen = searchParams.get("create") === "1";
    const setCreateOpen = (open: boolean) => {
        const next = new URLSearchParams(searchParams);
        if (open) next.set("create", "1");
        else next.delete("create");
        setSearchParams(next, { replace: true });
    };
    useEffect(() => {
        if (!createOpen) return;
        createForm.setFieldsValue({
            name: "",
            sourceType: createSource,
            aspectRatio: "9:16",
        });
    }, [createForm, createOpen]);

    const loadMoreRef = useRef<HTMLDivElement>(null);
    const query = useInfiniteQuery({
        // 分页查询和画布页的全量项目查询不能共用缓存形状，否则两个页面会互相覆盖缓存数据。
        queryKey: ["projects", "paged"],
        queryFn: ({ pageParam }) => listProjects({ page: pageParam, pageSize: 50 }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    });
    const mutation = useMutation({
        mutationFn: createProject,
        onSuccess: ({ project }) => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(project.sourceType === "blank" ? `/?project=${encodeURIComponent(project.id)}` : `/projects/${project.id}/chapters?import=1`);
        },
        onError: (error) => message.error(localizedErrorMessage(error, "项目创建失败", "Could not create project", locale)),
    });
    const deleteMutation = useMutation({
        mutationFn: deleteProject,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success(text("项目已删除", "Project deleted"));
        },
        onError: (error) => message.error(localizedErrorMessage(error, "项目删除失败", "Could not delete project", locale)),
    });
    const allProjects = useMemo(() => query.data?.pages.flatMap((page) => page.projects) || [], [query.data]);
    const rows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        return [...allProjects]
            .filter(({ project }) => status === "all" || project.status === status)
            .filter(({ project }) => !normalizedKeyword || `${project.name} ${project.description} ${project.stylePresetId} ${parseStyleProfile(project.styleProfileJson)?.title || resolveCanvasStylePreset(project.stylePresetId)?.title || ""}`.toLowerCase().includes(normalizedKeyword))
            .sort((left, right) => {
                if (sort === "name") return left.project.name.localeCompare(right.project.name, locale);
                if (sort === "progress") return projectSummaryCompletion(right) - projectSummaryCompletion(left);
                return right.project.updatedAt.localeCompare(left.project.updatedAt);
            });
    }, [allProjects, keyword, locale, sort, status]);
    const totalProjectCount = query.data?.pages[0]?.total ?? allProjects.length;
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !query.hasNextPage || query.isError) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting && !query.isFetchingNextPage) void query.fetchNextPage();
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [query.fetchNextPage, query.hasNextPage, query.isError, query.isFetchingNextPage]);
    const hasInitialError = query.isError && !query.data;
    return (
        <WorkspacePage className="library-page project-library-page" grid>
            <PageHeader
                title={text("我的项目", "My projects")}
                description={text("集中管理故事、素材、画布和制作进度。", "Organize stories, assets, canvases, and production progress.")}
                meta={<span>{totalProjectCount} {text("个项目", "projects")}</span>}
                actions={<Button type="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>{text("新建项目", "New project")}</Button>}
            />
            <CollectionToolbar active={Boolean(keyword || status !== "all" || sort !== "updated")} onReset={() => { setKeyword(""); setStatus("all"); setSort("updated"); }}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder={text("搜索项目、简介或画风", "Search projects, descriptions, or styles")} onChange={(event) => setKeyword(event.target.value)} />
                <Select className="w-32" value={status} onChange={setStatus} options={[{ label: text("全部状态", "All statuses"), value: "all" }, { label: text("进行中", "Active"), value: "active" }, { label: text("已归档", "Archived"), value: "archived" }]} />
                <Select className="w-32" value={sort} onChange={setSort} options={[{ label: text("最近更新", "Recently updated"), value: "updated" }, { label: text("章节进度", "Chapter progress"), value: "progress" }, { label: text("项目名称", "Project name"), value: "name" }]} />
            </CollectionToolbar>

            {hasInitialError ? <WorkspaceErrorState description={localizedErrorMessage(query.error, "项目列表加载失败", "Could not load projects", locale)} onRetry={() => void query.refetch()} /> : null}
            {query.isLoading ? <WorkspaceLoadingState label={text("正在整理项目", "Loading projects")} detail={text("读取章节、画布与资产进度", "Loading chapters, canvases, and asset progress")} /> : null}
            {!query.isLoading && !hasInitialError && rows.length ? (
                <CollectionGrid className="library-grid project-library-grid">
                    {rows.map((row) => <ProjectRow key={row.project.id} row={row} onDelete={() => deleteMutation.mutateAsync(row.project.id)} />)}
                </CollectionGrid>
            ) : null}
            {!query.isLoading && !hasInitialError ? <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                {query.isFetchingNextPage ? text("正在加载更多项目…", "Loading more projects...") : query.isError ? <button type="button" onClick={() => void query.fetchNextPage()}>{text("加载更多失败，点击重试", "Could not load more. Retry")}</button> : query.hasNextPage ? text("继续下滑加载更多（每页 50 条）", "Scroll for more projects (50 per page)") : allProjects.length ? locale === "en-US" ? `All ${totalProjectCount} projects loaded` : `已加载全部 ${totalProjectCount} 个项目` : null}
            </div> : null}
            {!query.isLoading && !rows.length && !hasInitialError ? (
                <WorkspaceState
                    icon="projects"
                    title={keyword || status !== "all" ? text("没有匹配的项目", "No matching projects") : text("创建第一个故事项目", "Create your first story project")}
                    description={keyword || status !== "all" ? text("调整搜索词或状态筛选后再试。", "Try another search or status filter.") : text("先创建项目，再用 AI 创作、导入故事或整理素材。", "Projects bring together chapters, canvases, assets, and production progress.")}
                    action={!keyword && status === "all" ? <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>{text("创建项目", "Create project")}</Button> : undefined}
                />
            ) : null}

            <Modal className="library-modal" title={text("新建项目", "New project")} open={createOpen} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)} width={560} styles={{ body: { paddingTop: 12 } }}>
                <Form<ProjectForm> form={createForm} layout="vertical" initialValues={{ aspectRatio: "9:16", sourceType: "blank" }} onFinish={(values) => mutation.mutate({ ...values, type: "short-drama", ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}) })}>
                    <div className="mb-4 grid grid-cols-3 gap-2">
                        <button type="button" aria-pressed={createSource === "blank"} className={createSource === "blank" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("blank"); createForm.setFieldValue("sourceType", "blank"); }}><FolderKanban className="size-4" /><span>{text("空白开始", "Start blank")}</span></button>
                        <button type="button" aria-pressed={createSource === "novel"} className={createSource === "novel" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("novel"); createForm.setFieldValue("sourceType", "novel"); }}><FileText className="size-4" /><span>{text("导入小说", "Import novel")}</span></button>
                        <button type="button" aria-pressed={createSource === "text"} className={createSource === "text" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("text"); createForm.setFieldValue("sourceType", "text"); }}><BookOpenText className="size-4" /><span>{text("粘贴文本", "Paste text")}</span></button>
                    </div>
                    <Form.Item name="name" label={text("项目名称", "Project name")} rules={[{ required: true, whitespace: true, message: text("请输入项目名称", "Enter a project name") }]}><Input autoFocus placeholder={text("例如：长安夜行", "For example: Night Journey")} /></Form.Item>
                    <Form.Item name="aspectRatio" label={text("默认画幅", "Default aspect ratio")}><Select options={[{ label: text("9:16 竖屏", "9:16 Portrait"), value: "9:16" }, { label: text("16:9 横屏", "16:9 Landscape"), value: "16:9" }, { label: text("1:1 方形", "1:1 Square"), value: "1:1" }]} /></Form.Item>
                    <Form.Item name="sourceType" hidden><Input /></Form.Item>
                    <Form.Item label={text("项目画风", "Project style")}><button type="button" className="app-story-modal-style" onClick={() => setStylePickerOpen(true)}>{selectedStyle ? <><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span><em>{text("更换", "Change")}</em></> : <><Palette className="size-4" /><span>{text("选择项目画风（可选）", "Choose a style (optional)")}</span></>}</button></Form.Item>
                    <p className="-mt-1 mb-5 text-[var(--fs-caption)] leading-5 text-muted-foreground">{text("空白项目进入 AI 创作；已有故事进入章节导入。所有内容均归入新项目。", "Blank projects open AI creation; existing stories open chapter import. Content belongs to the new project.")}</p>
                    <div className="flex justify-end gap-2"><Button onClick={() => setCreateOpen(false)}>{text("取消", "Cancel")}</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>{text("创建项目", "Create project")}</Button></div>
                </Form>
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => { setSelectedStyle(preset); setStylePickerOpen(false); }}
            />
        </WorkspacePage>
    );
}

const projectStageLabels: Record<string, string> = {
    "已归档": "Archived", "准备故事": "Plan story", "章节已完成": "Chapters complete",
    "组织章节": "Organize chapters", "准备资产": "Prepare assets", "制作中": "In production",
};

function ProjectRow({ row, onDelete }: { row: ProjectSummary; onDelete: () => Promise<unknown> }) {
    const { locale, text } = useLocaleText();
    const completion = projectSummaryCompletion(row);
    const stage = projectSummaryStage(row);
    const projectStyle = resolveProjectCanvasStyle(row.project.stylePresetId, row.project.styleProfileJson);
    const styleTitle = projectStyle?.title || parseStyleProfile(row.project.styleProfileJson)?.title || resolveCanvasStylePreset(row.project.stylePresetId)?.title || (row.project.stylePresetId ? text("自定义画风", "Custom style") : text("未设置画风", "No style"));
    const coverUrl = row.project.coverResourceId ? resourceFileUrl(row.project.coverResourceId) : projectStyle?.imageUrl;
    return (
        <Link to={`/projects/${row.project.id}/overview`} className="product-collection-card library-card project-library-card group">
            <span className="project-library-cover">
                {coverUrl ? <CachedResourceImage className="project-library-cover-art" src={coverUrl} alt="" fallback={<MediaPlaceholder failed />} /> : <MediaPlaceholder label={text("故事由此开始", "Your story starts here")} />}
                <span className="project-library-cover-scrim" />
                <span className="project-library-cover-ratio">{row.project.aspectRatio}</span>
                <span className="project-library-cover-stage">{localeText(stage.label, projectStageLabels[stage.label] || stage.label, locale)}</span>
                <span className="project-collection-delete"><DeleteButton label={locale === "en-US" ? `Delete project ${row.project.name}` : `删除项目 ${row.project.name}`} description={text("项目章节、画布关联和素材归属将一并移除；独立画布与素材库原始素材会保留。此操作不可撤销。", "Chapters, canvas links, and project assets will be removed. Standalone canvases and original library assets remain. This cannot be undone.")} onConfirm={onDelete} /></span>
            </span>
            <span className="project-library-body">
                <span className="project-library-heading"><strong title={row.project.name}>{row.project.name}</strong>{row.project.status === "archived" ? <em>{text("已归档", "Archived")}</em> : null}<ArrowRight className="project-library-arrow size-4" /></span>
                <span className="project-library-subtitle">{styleTitle} · {locale === "en-US" ? ({ blank: "Started blank", novel: "Imported novel", text: "Pasted text" } as Record<string, string>)[row.project.sourceType] || "Other source" : sourceTypeLabel(row.project.sourceType)}</span>
                <span className="project-library-progress"><span><span>{row.completedUnitCount}/{row.unitCount} {text("章", "chapters")}</span><span>{completion}%</span></span><i><b style={{ width: `${completion}%` }} /></i></span>
                <span className="project-library-stats"><ProjectCount icon={<BookOpenText className="size-3.5" />} label={text("章节", "Chapters")} value={row.unitCount} /><ProjectCount icon={<LayoutGrid className="size-3.5" />} label={text("画布", "Canvases")} value={row.canvasCount} /><ProjectCount icon={<Images className="size-3.5" />} label={text("素材", "Assets")} value={row.assetCount} /></span>
            </span>
        </Link>
    );
}

function ProjectCount({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
    return <span className="inline-flex items-center gap-1.5" title={`${value} ${label}`}><span className="text-foreground/32">{icon}</span><strong className="font-medium tabular-nums text-foreground/65">{value}</strong><span>{label}</span></span>;
}
