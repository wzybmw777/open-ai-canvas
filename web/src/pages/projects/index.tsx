import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal } from "antd";
import { ArrowRight, BookOpenText, FileText, FolderKanban, Images, LayoutGrid, Palette, Plus, Search, Sparkles } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { CanvasStylePickerModal, resolveCanvasStylePreset, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { resourceFileUrl } from "@/services/api/resources";
import { ModelPicker } from "@/components/model-picker";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { settingsPath } from "@/lib/settings-navigation";
import { PromptTemplateOperation, parseGeneratedStory, promptTemplateTaskPlaceholder, shortDramaOutlineVariables } from "@/lib/prompts";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { createProject, deleteProject, importProjectUnits, listProjects, type ProjectSummary } from "@/services/api/projects";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

import { sourceTypeLabel } from "./detail/shared";
import { Select } from "@/components/ui/base/select";
import { localeText, localizedErrorMessage, useLocaleText, type AppLocale } from "@/lib/i18n";

type ProjectForm = { name: string; aspectRatio: string; sourceType: string };

const storySettingLabels: Record<string, string> = {
    "单线推进": "Single storyline", "双线并行": "Parallel storylines", "群像多线": "Ensemble storylines", "反转嵌套": "Layered twists",
    "第三人称": "Third person", "第一人称": "First person", "多视角": "Multiple viewpoints",
    "平稳叙事": "Steady narrative", "轻松喜剧": "Light comedy", "紧张悬疑": "Suspense", "热血成长": "Coming of age", "甜宠治愈": "Romance",
    "2 个": "2 characters", "3-4 个": "3-4 characters", "5-6 个": "5-6 characters",
};

function storySettingLabel(value: string, locale: AppLocale) {
    return locale === "en-US" ? storySettingLabels[value] || value : value;
}

export default function ProjectsPage() {
    const { locale, text } = useLocaleText();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const [createForm] = Form.useForm<ProjectForm>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const [storyDraft, setStoryDraft] = useState("");
    const [createSource, setCreateSource] = useState<"blank" | "novel" | "text">("blank");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [generateModel, setGenerateModel] = useState("");
    const [generateChapterCount, setGenerateChapterCount] = useState("5");
    const [generateStructure, setGenerateStructure] = useState("单线推进");
    const [generateChapterLength, setGenerateChapterLength] = useState("中");
    const [generateWordCount, setGenerateWordCount] = useState("800");
    const [generatePerspective, setGeneratePerspective] = useState("第三人称");
    const [generateTone, setGenerateTone] = useState("平稳叙事");
    const [generateCharacterScale, setGenerateCharacterScale] = useState("3-4 个");
    const [generating, setGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState("");
    const [generationPreview, setGenerationPreview] = useState("");
    const createOpen = searchParams.get("create") === "1";
    const setCreateOpen = (open: boolean) => {
        const next = new URLSearchParams(searchParams);
        if (open) next.set("create", "1");
        else next.delete("create");
        setSearchParams(next, { replace: true });
    };
    const openCreate = (source: "blank" | "novel" | "text") => {
        setCreateSource(source);
        setCreateOpen(true);
    };
    useEffect(() => {
        if (!createOpen) return;
        createForm.setFieldsValue({
            name: storyDraft.trim().slice(0, 24) || "",
            sourceType: createSource,
            aspectRatio: "9:16",
        });
    }, [createForm, createOpen, createSource, storyDraft]);

    const generateStory = async () => {
        const story = storyDraft.trim();
        if (!story || generating) return;
        const textModel = generateModel || effectiveConfig.textModel;
        if (!textModel || !effectiveConfig.textModels.includes(textModel)) {
            if (!textModel) {
                modal.warning({
                    title: text("需要先选择文本模型", "Select a text model first"),
                    content: text("请在上方“AI 模型”中选择一个已配置的文本模型，或先到设置中完成模型渠道配置。", "Choose a configured text model above, or set up a model channel in Settings."),
                    okText: text("去设置", "Open settings"),
                    cancelText: text("取消", "Cancel"),
                    onOk: () => navigate(settingsPath("models")),
                });
            } else {
                message.error(locale === "en-US" ? `Model ${textModel} is not available for text. Choose another model.` : `模型 ${textModel} 未在文本模型列表中，请重新选择`);
            }
            return;
        }
        setGenerating(true);
        setGenerationStatus("正在创建项目…");
        setGenerationPreview("");
        try {
            const project = await createUniqueProjectName(story, selectedStyle);
            setGenerationStatus("AI 正在生成故事大纲与章节…");
            const result = await runBackendGenerationTask({
                projectId: project.project.id,
                mode: "text",
                prompt: promptTemplateTaskPlaceholder("短剧大纲"),
                config: { ...effectiveConfig, model: textModel, imageModel: textModel, videoModel: textModel, textModel },
                metadata: {
                    source: "project-story-generator",
                    projectId: project.project.id,
                    promptTemplateOperation: PromptTemplateOperation.ShortDramaOutline,
                    promptTemplateVariables: shortDramaOutlineVariables({
                        story,
                        chapterCount: generateChapterCount,
                        structure: generateStructure,
                        wordCount: generateWordCount,
                        perspective: generatePerspective,
                        tone: generateTone,
                        characterScale: generateCharacterScale,
                        chapterLength: generateChapterLength,
                    }),
                },
                onTextDelta: setGenerationPreview,
            });
            const answer = result.text || "";
            const parsed = parseGeneratedStory(answer);
            if (!parsed.chapters.length) throw new Error(text("AI 没有返回有效的章节内容，请重试", "The model did not return valid chapters. Try again."));
            setGenerationStatus(`正在导入 ${parsed.chapters.length} 个章节…`);
            await importProjectUnits(project.project.id, parsed.chapters.map((chapter: { title: string; content: string }) => ({ kind: "chapter", title: chapter.title, sourceText: chapter.content })));
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.project.id}/overview`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "AI 生成失败，请重试", "Could not generate chapters. Try again.", locale));
        } finally {
            setGenerating(false);
            setGenerationStatus("");
            setGenerationPreview("");
        }
    };
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
            navigate(`/projects/${project.id}/overview`);
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
            <details className="story-launcher-panel" aria-label={text("开始一部新短剧", "Start a new short drama")}>
                <summary className="story-launcher-head">
                    <div className="story-launcher-title">
                        <span className="story-launcher-mark"><Sparkles className="size-4" /></span>
                        <div>
                            <h2>{text("开始一部新短剧", "Start a new short drama")}</h2>
                            <p>{text("一句话生成章节，也可以导入小说或从空白开始", "Generate chapters from an idea, import a novel, or start from scratch")}</p>
                        </div>
                    </div>
                    <span className="story-launcher-expand"><Plus className="size-4" /><span>{text("展开创作", "Expand")}</span></span>
                </summary>
                <div className="story-launcher-main">
                    <Input.TextArea
                        className="story-launcher-input"
                        value={storyDraft}
                        onChange={(event) => setStoryDraft(event.target.value)}
                        placeholder={text("例如：一个失忆的快递员，每天收到十年前寄出的信件……", "For example: A courier with amnesia receives letters mailed ten years ago...")}
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        aria-label={text("一句话故事", "Story idea")}
                    />
                    {selectedStyle ? <button type="button" className="story-launcher-style-chip" onClick={() => setStylePickerOpen(true)} title={selectedStyle.title}>
                        <img src={selectedStyle.imageUrl} alt="" />
                        <span>{selectedStyle.title}</span>
                    </button> : null}
                </div>
                    <div className="story-launcher-actions">
                        <Button icon={<FolderKanban />} onClick={() => openCreate("blank")}>{text("空白项目", "Blank project")}</Button>
                        <Button icon={<FileText />} onClick={() => openCreate("novel")}>{text("导入小说", "Import novel")}</Button>
                        <Button icon={<Palette />} onClick={() => setStylePickerOpen(true)}>{selectedStyle ? text("更换画风", "Change style") : text("选画风", "Choose style")}</Button>
                        <ModelPicker
                            config={effectiveConfig}
                            value={generateModel || effectiveConfig.textModel}
                            onChange={setGenerateModel}
                            capability="text"
                            variant="creation"
                            placeholder={text("选择文本模型", "Select text model")}
                            showSelectedPrice={false}
                            showOptionPrices
                            popoverClassName="agent-model-picker-popover"
                        />
                        <Button type="default" icon={<Sparkles className="size-3.5" />} disabled={!storyDraft.trim() || generating} loading={generating} onClick={() => void generateStory()}>{text("AI 生成章节", "Generate chapters")}</Button>
                        <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate(createSource)}>{text("开始创作", "Create project")}</Button>
                    </div>
                <details className="story-launcher-options">
                    <summary>{text("故事设置", "Story settings")} · {generateChapterCount} {text("章", "chapters")} · {storySettingLabel(generatePerspective, locale)} · {storySettingLabel(generateTone, locale)}</summary>
                <div className="story-launcher-controls">
                    <label><span>{text("章节数量", "Chapters")}</span><Select size="small" className="min-w-28" value={generateChapterCount} onChange={setGenerateChapterCount} options={["3", "5", "8", "10"].map((value) => ({ label: `${value} ${text("章", "chapters")}`, value }))} /></label>
                    <label><span>{text("叙事结构", "Structure")}</span><Select size="small" className="min-w-32" value={generateStructure} onChange={setGenerateStructure} options={["单线推进", "双线并行", "群像多线", "反转嵌套"].map((value) => ({ label: storySettingLabel(value, locale), value }))} /></label>
                    <label><span>{text("章节篇幅", "Chapter length")}</span><Select size="small" className="min-w-28" value={generateChapterLength} onChange={setGenerateChapterLength} options={[{ label: text("精炼", "Concise"), value: "短" }, { label: text("均衡", "Balanced"), value: "中" }, { label: text("丰满", "Detailed"), value: "长" }]} /></label>
                    <label><span>{text("单章字数", "Words per chapter")}</span><Select size="small" className="min-w-28" value={generateWordCount} onChange={setGenerateWordCount} options={["500", "800", "1200", "2000"].map((value) => ({ label: `${value} ${text("字", "words")}`, value }))} /></label>
                    <label><span>{text("叙述视角", "Point of view")}</span><Select size="small" className="min-w-28" value={generatePerspective} onChange={setGeneratePerspective} options={["第三人称", "第一人称", "多视角"].map((value) => ({ label: storySettingLabel(value, locale), value }))} /></label>
                    <label><span>{text("故事基调", "Tone")}</span><Select size="small" className="min-w-32" value={generateTone} onChange={setGenerateTone} options={["平稳叙事", "轻松喜剧", "紧张悬疑", "热血成长", "甜宠治愈"].map((value) => ({ label: storySettingLabel(value, locale), value }))} /></label>
                    <label><span>{text("角色规模", "Cast size")}</span><Select size="small" className="min-w-28" value={generateCharacterScale} onChange={setGenerateCharacterScale} options={["2 个", "3-4 个", "5-6 个"].map((value) => ({ label: storySettingLabel(value, locale), value }))} /></label>
                </div>
                </details>
            </details>
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
                    description={keyword || status !== "all" ? text("调整搜索词或状态筛选后再试。", "Try another search or status filter.") : text("项目会集中保存章节、项目画布、角色场景和制作进度。自由试图可从画布开始。", "Projects bring together chapters, canvases, assets, and production progress.")}
                    action={!keyword && status === "all" ? <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>{text("创建项目", "Create project")}</Button> : undefined}
                />
            ) : null}

            <Modal className="library-modal" title={text("创建短剧项目", "Create short drama project")} open={createOpen} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)} width={560} styles={{ body: { paddingTop: 12 } }}>
                <Form<ProjectForm> form={createForm} layout="vertical" initialValues={{ aspectRatio: "9:16", sourceType: "blank" }} onFinish={(values) => mutation.mutate({ ...values, type: "short-drama", ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}) })}>
                    <div className="mb-4 grid grid-cols-3 gap-2">
                        <button type="button" className={createSource === "blank" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("blank"); createForm.setFieldValue("sourceType", "blank"); }}><FolderKanban className="size-4" /><span>{text("空白开始", "Start blank")}</span></button>
                        <button type="button" className={createSource === "novel" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("novel"); createForm.setFieldValue("sourceType", "novel"); }}><FileText className="size-4" /><span>{text("导入小说", "Import novel")}</span></button>
                        <button type="button" className={createSource === "text" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("text"); createForm.setFieldValue("sourceType", "text"); }}><BookOpenText className="size-4" /><span>{text("粘贴文本", "Paste text")}</span></button>
                    </div>
                    <Form.Item name="name" label={text("项目名称", "Project name")} rules={[{ required: true, whitespace: true, message: text("请输入项目名称", "Enter a project name") }]}><Input autoFocus placeholder={text("例如：长安夜行", "For example: Night Journey")} /></Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="aspectRatio" label={text("默认画幅", "Default aspect ratio")}><Select options={[{ label: text("9:16 竖屏", "9:16 Portrait"), value: "9:16" }, { label: text("16:9 横屏", "16:9 Landscape"), value: "16:9" }, { label: text("1:1 方形", "1:1 Square"), value: "1:1" }]} /></Form.Item>
                        <Form.Item name="sourceType" label={text("内容来源", "Content source")}><Select options={[{ label: text("空白开始", "Start blank"), value: "blank" }, { label: text("导入小说", "Import novel"), value: "novel" }, { label: text("粘贴文本", "Paste text"), value: "text" }]} /></Form.Item>
                    </div>
                    <Form.Item label={text("项目画风", "Project style")}><button type="button" className="app-story-modal-style" onClick={() => setStylePickerOpen(true)}>{selectedStyle ? <><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span><em>{text("更换", "Change")}</em></> : <><Palette className="size-4" /><span>{text("选择项目画风（可选）", "Choose a style (optional)")}</span></>}</button></Form.Item>
                    <p className="-mt-1 mb-5 text-xs leading-5 text-foreground/48">{text("创建后先进入项目概览。章节、画风和参考资产可以逐步补充。", "You'll start at the project overview. Add chapters, styles, and reference assets as you go.")}</p>
                    <div className="flex justify-end gap-2"><Button onClick={() => setCreateOpen(false)}>{text("取消", "Cancel")}</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>{text("创建项目", "Create project")}</Button></div>
                </Form>
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => { setSelectedStyle(preset); setStylePickerOpen(false); }}
            />
            <Modal className="library-modal" title={text("AI 生成章节", "Generate chapters")} open={generating} footer={null} closable={false} mask={{ closable: false }} keyboard={false} width={760}>
                <div className="app-story-generating">
                    <div className="app-story-generating-head">
                        <span className="app-story-generating-mark"><Sparkles className="size-4" /></span>
                        <div className="min-w-0">
                            <p>{text("AI 正在创作", "AI is writing")}</p>
                            <span className="block text-[var(--fs-tiny)] text-foreground/45">{text("正在生成剧名、简介与章节", "Generating a title, synopsis, and chapters")}</span>
                        </div>
                        {generateModel || effectiveConfig.textModel ? <span className="app-story-generating-model">{modelDisplayName(effectiveConfig, generateModel || effectiveConfig.textModel)}</span> : null}
                    </div>
                    <div className="app-story-generating-progress" aria-hidden="true" />
                    <div className="app-story-generating-grid">
                        <div className="app-story-generating-story">
                            <span className="app-story-generating-caption">{text("故事起点", "Story idea")}</span>
                            <p>{storyDraft.trim() || text("等待故事输入", "Waiting for story input")}</p>
                            <span className="app-story-generating-meta">{locale === "en-US" ? `${generateChapterCount} chapters · about ${generateWordCount} words each · ${storySettingLabel(generateStructure, locale)} · ${storySettingLabel(generatePerspective, locale)}` : `${generateChapterCount} 章 · 每章约 ${generateWordCount} 字 · ${generateStructure} · ${generatePerspective}`}</span>
                            {selectedStyle ? <span className="app-story-generating-style"><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span></span> : null}
                        </div>
                        <ol className="app-story-generating-steps">
                            {generationSteps.map((step) => {
                                const state = generationStatus.startsWith(step.label) ? "is-active" : generationStepDone(step.label, generationStatus) ? "is-done" : "";
                                return <li key={step.label} className={state}><span className="app-story-generating-step-dot" /><span>{localeText(step.label, step.english, locale)}</span><em>{state === "is-active" ? text("进行中", "In progress") : state === "is-done" ? text("完成", "Done") : text("等待", "Waiting")}</em></li>;
                            })}
                        </ol>
                    </div>
                    <div className="app-story-generating-preview">
                        <div className="app-story-generating-preview-head"><span>{text("实时草稿", "Live draft")}</span><span className="app-story-generating-live" /><em>{generationPreview ? text("正在输出", "Generating") : text("等待模型输出", "Waiting for model")}</em></div>
                        <pre>{generationPreview}</pre>
                    </div>
                </div>
            </Modal>
        </WorkspacePage>
    );
}

async function createUniqueProjectName(story: string, selectedStyle: CanvasStylePreset | null) {
    const base = story.trim().slice(0, 24);
    const buildInput = (name: string) => ({
        name,
        type: "short-drama" as const,
        aspectRatio: "9:16",
        sourceType: "blank",
        description: story.trim(),
        ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}),
    });
    let attempt = 0;
    for (;;) {
        try {
            return await createProject(buildInput(attempt === 0 ? base : `${base}（${attempt + 1}）`));
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            const uniqueConflict = message.includes("UNIQUE") || message.includes("projects.user_id") || message.includes("projects.name");
            if (!uniqueConflict || attempt >= 5) throw error;
            attempt += 1;
        }
    }
}

const generationSteps = [
    { label: "正在创建项目", english: "Creating project" },
    { label: "AI 正在生成故事大纲与章节", english: "Generating outline and chapters" },
    { label: "正在导入章节", english: "Importing chapters" },
];

const projectStageLabels: Record<string, string> = {
    "已归档": "Archived", "准备故事": "Plan story", "章节已完成": "Chapters complete",
    "组织章节": "Organize chapters", "准备资产": "Prepare assets", "制作中": "In production",
};

function generationStepDone(label: string, status: string) {
    if (label === "正在创建项目") return status.startsWith("AI 正在生成") || status.startsWith("正在导入");
    if (label === "AI 正在生成故事大纲与章节") return status.startsWith("正在导入");
    return false;
}

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
                <span className="project-library-stats"><ProjectCount icon={<BookOpenText className="size-3.5" />} label={text("章节", "Chapters")} value={row.unitCount} /><ProjectCount icon={<LayoutGrid className="size-3.5" />} label={text("画布", "Canvases")} value={row.canvasCount} /><ProjectCount icon={<Images className="size-3.5" />} label={text("资产", "Assets")} value={row.assetCount} /></span>
            </span>
        </Link>
    );
}

function ProjectCount({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
    return <span className="inline-flex items-center gap-1.5" title={`${value} ${label}`}><span className="text-foreground/32">{icon}</span><strong className="font-medium tabular-nums text-foreground/65">{value}</strong><span>{label}</span></span>;
}
