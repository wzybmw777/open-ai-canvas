import { parseGeneratedStory, PromptTemplateOperation } from "@/lib/prompts";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import type { GenerationTask } from "@/services/api/task-center";

export function projectStoryChapters(task: GenerationTask, projectId: string) {
    if (!projectId || task.projectId !== projectId) throw new Error("章节任务不属于当前项目");
    const input = JSON.parse(task.inputJson || "{}");
    if (input?.metadata?.source !== "project-story-generator" || input.metadata.promptTemplateOperation !== PromptTemplateOperation.ShortDramaOutline) {
        throw new Error("该任务不是项目章节生成任务");
    }
    if (task.status !== "succeeded") return [];
    const chapters = parseGeneratedStory(parseBackendGenerationResult(task).text || "").chapters;
    if (!chapters.length) throw new Error("AI 没有返回有效的章节内容，请调整故事要求后重试");
    return chapters;
}
