import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Modal } from "antd";
import { Sparkles } from "lucide-react";
import { useSearchParams } from "react-router";
import { ModelPicker } from "@/components/model-picker";
import { Select } from "@/components/ui/base/select";
import { useLocaleText, localizedErrorMessage } from "@/lib/i18n";
import { PromptTemplateOperation, promptTemplateTaskPlaceholder, shortDramaOutlineVariables } from "@/lib/prompts";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { getProjectCore, getProjectUnit, importProjectUnits, listProjectUnits, type Project } from "@/services/api/projects";
import { cancelGenerationTask, queryGenerationTask } from "@/services/api/task-center";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { projectStoryChapters } from "./project-story-generation";
import { statusLabel } from "./shared";

export function ProjectStoryGenerator({ project, refreshProject }: { project: Project; refreshProject: () => void }) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const userId = useUserStore((state) => state.user?.id);
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const taskId = searchParams.get("storyTask") || "";
    const [open, setOpen] = useState(Boolean(taskId));
    const [story, setStory] = useState(project.description || "");
    const [model, setModel] = useState("");
    const [chapterCount, setChapterCount] = useState("5");
    const [wordCount, setWordCount] = useState("800");
    const [structure, setStructure] = useState("单线推进");
    const [perspective, setPerspective] = useState("第三人称");
    const [tone, setTone] = useState("平稳叙事");
    const [characterScale, setCharacterScale] = useState("3-4 个");
    const [chapterLength, setChapterLength] = useState("中");
    const mounted = useRef(true);
    const requestAbort = useRef<AbortController | null>(null);
    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        requestAbort.current = controller;
        return () => { mounted.current = false; controller.abort(); };
    }, [project.id, userId]);
    const currentScope = () => mounted.current && Boolean(userId) && useUserStore.getState().user?.id === userId;
    const setTaskId = (id: string) => setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("storyTask", id); else next.delete("storyTask");
        return next;
    }, { replace: true });
    const taskKey = ["project-story-task", userId, project.id, taskId];
    const taskQuery = useQuery({
        queryKey: taskKey,
        queryFn: async ({ signal }) => {
            const task = await queryGenerationTask(taskId, { signal });
            projectStoryChapters(task, project.id);
            return task;
        },
        enabled: Boolean(userId && taskId),
        retry: false,
        refetchInterval: (query) => query.state.data?.status === "queued" || query.state.data?.status === "running" ? 2000 : false,
    });
    const task = taskQuery.data;
    const running = task?.status === "queued" || task?.status === "running";
    const chapters = useMemo(() => task ? projectStoryChapters(task, project.id) : [], [task, project.id]);
    const savedKey = ["project-story-saved", userId, project.id, taskId];
    const savedQuery = useQuery({
        queryKey: savedKey,
        queryFn: async () => {
            const { units } = await listProjectUnits(project.id);
            // 列表不含正文；只有读取同名章节后，才能确认草稿是否已经保存。
            const candidates = await Promise.all(units.filter((unit) => chapters.some((chapter) => chapter.title === unit.title)).map((unit) => getProjectUnit(project.id, unit.id)));
            return chapters.filter((chapter) => !candidates.some(({ unit }) => unit.title === chapter.title && unit.sourceText === chapter.content));
        },
        enabled: Boolean(userId && chapters.length),
        retry: false,
    });
    const imported = savedQuery.data?.length === 0;
    const selectedModel = model || config.textModel;
    const notifyError = (error: unknown) => message.error(localizedErrorMessage(error, "操作失败，请重试", "Could not complete this action. Try again.", locale));
    const assertActiveProject = async () => {
        if (!currentScope()) throw new Error(text("登录状态已变化，请重新打开项目", "Your session changed. Reopen the project."));
        const current = await getProjectCore(project.id);
        if (!currentScope() || current.project.status !== "active") throw new Error(text("项目已归档或不可用", "The project is archived or unavailable."));
    };
    const submit = useMutation({
        mutationFn: async () => {
            if (!story.trim() || !selectedModel || !config.textModels.includes(selectedModel)) throw new Error(text("请填写故事并选择可用的文本模型", "Enter a story and select an available text model."));
            await assertActiveProject();
            return submitBackendGenerationTask({
                projectId: project.id,
                signal: requestAbort.current?.signal,
                mode: "text",
                prompt: promptTemplateTaskPlaceholder("短剧大纲"),
                config: { ...config, model: selectedModel, textModel: selectedModel },
                metadata: {
                    source: "project-story-generator",
                    projectId: project.id,
                    promptTemplateOperation: PromptTemplateOperation.ShortDramaOutline,
                    promptTemplateVariables: shortDramaOutlineVariables({ story: story.trim(), chapterCount, structure, wordCount, perspective, tone, characterScale, chapterLength }),
                },
            });
        },
        onSuccess: (created) => {
            if (!currentScope()) return;
            setTaskId(created.id);
            void queryClient.invalidateQueries({ queryKey: ["project-chapter-generation-tasks", project.id] });
        },
        onError: notifyError,
    });
    const importChapters = useMutation({
        mutationFn: async () => {
            await assertActiveProject();
            const latestTask = await queryGenerationTask(taskId);
            const result = projectStoryChapters(latestTask, project.id);
            if (!result.length || !currentScope()) throw new Error(text("任务尚未完成", "The task is not complete."));
            const { data: missing } = await savedQuery.refetch({ throwOnError: true });
            if (!currentScope()) throw new Error(text("登录状态已变化", "Your session changed."));
            if (!missing) throw new Error(text("无法确认已保存章节，请重试", "Could not check saved chapters. Try again."));
            if (missing.length) await importProjectUnits(project.id, missing.map((chapter) => ({ kind: "chapter", title: chapter.title, sourceText: chapter.content })));
            return latestTask.id;
        },
        onSuccess: () => {
            if (!currentScope()) return;
            queryClient.setQueryData(savedKey, []);
            refreshProject();
            message.success(text("章节已添加到当前项目", "Chapters added to this project."));
        },
        onError: notifyError,
    });
    const cancel = useMutation({
        mutationFn: async () => {
            if (!currentScope() || !task || task.projectId !== project.id) throw new Error(text("任务不可用", "The task is unavailable."));
            return cancelGenerationTask(task.id);
        },
        onSuccess: () => { void taskQuery.refetch(); },
        onError: notifyError,
    });
    const choices = (zh: string[], en: string[]) => zh.map((value, index) => ({ value, label: text(value, en[index]) }));
    return <>
        <Button size="small" icon={<Sparkles className="size-3.5" />} disabled={project.status !== "active"} onClick={() => setOpen(true)}>
            {taskId ? text("章节任务", "Chapter task") : text("AI 写章节", "Write chapters")}
        </Button>
        <Modal title={text("为项目生成章节", "Write project chapters")} open={open} onCancel={() => setOpen(false)} footer={null} width={640}>
            <div className="space-y-4">
                <p className="text-[var(--fs-caption)] text-muted-foreground">{project.name} · {text("预览后添加到章节列表", "Review before adding to your chapter list")}</p>
                {taskId ? <>
                    {taskQuery.isPending ? <p role="status">{text("正在读取任务…", "Loading task...")}</p> : null}
                    {taskQuery.isError ? <div role="alert"><p>{localizedErrorMessage(taskQuery.error, "读取任务失败", "Could not load task", locale)}</p><Button onClick={() => void taskQuery.refetch()}>{text("重试", "Retry")}</Button></div> : null}
                    {task ? <>
                        <p role="status">{statusLabel(task.status, locale)}{running ? ` · ${text("可以关闭窗口，任务会继续运行", "You can close this window; the task will keep running")}` : ""}</p>
                        {task.error ? <p role="alert">{task.error}</p> : null}
                        {chapters.length ? <div className="max-h-80 space-y-4 overflow-y-auto rounded-lg border border-border p-4" aria-label={text("章节预览", "Chapter preview")}>{chapters.map((chapter, index) => <section key={index}><h3 className="font-semibold">{chapter.title}</h3><p className="whitespace-pre-wrap text-sm leading-6">{chapter.content}</p></section>)}</div> : task.textDraft ? <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm">{task.textDraft}</pre> : null}
                    </> : null}
                    {savedQuery.isError ? <p role="alert">{text("读取已保存章节失败。", "Could not check saved chapters.")}<Button size="small" onClick={() => void savedQuery.refetch()}>{text("重试", "Retry")}</Button></p> : null}
                    <div className="flex flex-wrap justify-end gap-2">
                        {running ? <Button danger loading={cancel.isPending} onClick={() => cancel.mutate()}>{text("取消任务", "Cancel task")}</Button> : <Button disabled={taskQuery.isPending || importChapters.isPending} onClick={() => setTaskId("")}>{text("新的章节草稿", "New chapter draft")}</Button>}
                        {chapters.length ? <Button type="primary" loading={importChapters.isPending} disabled={imported || savedQuery.isPending || savedQuery.isError || project.status !== "active"} onClick={() => importChapters.mutate()}>{imported ? text("已添加", "Added") : text(`添加 ${savedQuery.data?.length ?? chapters.length} 个章节`, `Add ${savedQuery.data?.length ?? chapters.length} chapters`)}</Button> : null}
                        <Button onClick={() => setOpen(false)}>{text("关闭", "Close")}</Button>
                    </div>
                </> : <>
                    <label className="block space-y-2"><span>{text("故事想法", "Story idea")}</span><Input.TextArea value={story} onChange={(event) => setStory(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} disabled={submit.isPending} placeholder={text("描述主角、目标和冲突…", "Describe the protagonist, goal, and conflict...")} /></label>
                    <ModelPicker config={config} value={selectedModel} onChange={setModel} capability="text" variant="creation" showSelectedPrice showOptionPrices />
                    <details>
                        <summary className="cursor-pointer text-[var(--fs-caption)] text-muted-foreground">{text("故事设置", "Story settings")} · {chapterCount} {text("章", "chapters")} · {wordCount} {text("字/章", "words/chapter")}</summary>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <label>{text("章节数量", "Chapters")}<Select className="w-full" value={chapterCount} onChange={setChapterCount} options={["3", "5", "8", "10"].map(value => ({ value, label: value }))} /></label>
                            <label>{text("每章字数", "Words per chapter")}<Select className="w-full" value={wordCount} onChange={setWordCount} options={["500", "800", "1200", "2000"].map(value => ({ value, label: value }))} /></label>
                            <label>{text("叙事结构", "Structure")}<Select className="w-full" value={structure} onChange={setStructure} options={choices(["单线推进", "双线并行", "群像多线", "反转嵌套"], ["Single storyline", "Parallel storylines", "Ensemble", "Layered twists"])} /></label>
                            <label>{text("叙述视角", "Viewpoint")}<Select className="w-full" value={perspective} onChange={setPerspective} options={choices(["第三人称", "第一人称", "多视角"], ["Third person", "First person", "Multiple viewpoints"])} /></label>
                            <label>{text("故事基调", "Tone")}<Select className="w-full" value={tone} onChange={setTone} options={choices(["平稳叙事", "轻松喜剧", "紧张悬疑", "热血成长", "甜宠治愈"], ["Steady", "Comedy", "Suspense", "Coming of age", "Romance"])} /></label>
                            <label>{text("角色规模", "Cast size")}<Select className="w-full" value={characterScale} onChange={setCharacterScale} options={choices(["2 个", "3-4 个", "5-6 个"], ["2", "3–4", "5–6"])} /></label>
                            <label>{text("章节篇幅", "Chapter length")}<Select className="w-full" value={chapterLength} onChange={setChapterLength} options={choices(["短", "中", "长"], ["Concise", "Balanced", "Detailed"])} /></label>
                        </div>
                    </details>
                    <p className="text-[var(--fs-caption)] text-muted-foreground">{text("字数和章节数量会影响用量，费用按所选模型的实际生成用量结算。", "Chapter count and length affect usage. Charges follow the selected model's actual usage.")}</p>
                    <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>{text("取消", "Cancel")}</Button><Button type="primary" loading={submit.isPending} disabled={!story.trim() || !selectedModel || project.status !== "active"} onClick={() => submit.mutate()}>{text("生成章节草稿", "Generate chapter draft")}</Button></div>
                </>}
            </div>
        </Modal>
    </>;
}
