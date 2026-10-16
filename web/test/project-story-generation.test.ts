import { describe, expect, test } from "bun:test";
import { PromptTemplateOperation } from "../src/lib/prompts";
import { projectStoryChapters } from "../src/pages/projects/detail/project-story-generation";
import type { GenerationTask } from "../src/services/api/task-center";

function task(overrides: Partial<GenerationTask> = {}): GenerationTask {
    return {
        id: "story-task", projectId: "project-a", type: "canvas_text", status: "succeeded", prompt: "story", attempts: 1,
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
        inputJson: JSON.stringify({ metadata: { source: "project-story-generator", promptTemplateOperation: PromptTemplateOperation.ShortDramaOutline } }),
        resultJson: JSON.stringify({ text: JSON.stringify({ title: "重逢", chapters: [{ title: "雨夜", content: "旧友在车站重逢。" }] }) }),
        ...overrides,
    };
}

describe("recover project chapter drafts", () => {
    test("recovers a completed server task without creating another generation", () => {
        expect(projectStoryChapters(task(), "project-a")).toEqual([{ title: "雨夜", content: "旧友在车站重逢。" }]);
    });
    test("rejects another project's task even when the result is valid", () => {
        expect(() => projectStoryChapters(task(), "project-b")).toThrow("不属于当前项目");
        expect(() => projectStoryChapters(task({ projectId: undefined }), "")).toThrow();
    });
    test("rejects unrelated text results and incomplete output", () => {
        expect(() => projectStoryChapters(task({ inputJson: "{}" }), "project-a")).toThrow("不是项目章节");
        expect(() => projectStoryChapters(task({ resultJson: '{"text":"no chapters"}' }), "project-a")).toThrow("有效的章节");
    });
    test("running and failed tasks cannot import partial chapters", () => {
        expect(projectStoryChapters(task({ status: "running" }), "project-a")).toEqual([]);
        expect(projectStoryChapters(task({ status: "failed" }), "project-a")).toEqual([]);
    });
});
