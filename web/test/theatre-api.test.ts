import { expect, test } from "bun:test";
import { apiClient, ApiError } from "../src/services/api/request";
import { createTheatreWork, deleteTheatreWork, getTheatreWork, listTheatreWorks, theatreCoverUrl, theatreEpisodeVideoUrl, theatreVideoUrl, updateTheatreWork } from "../src/services/api/theatre";

test("剧场查询解包分页数据并传递筛选和取消信号", async () => {
    const original = apiClient.defaults.adapter;
    const controller = new AbortController();
    try {
        apiClient.defaults.adapter = async (config) => {
            expect(config.url).toBe("/theatre/works");
            expect(config.params).toEqual({ mine: "true", page: 2, pageSize: 12 });
            expect(config.signal).toBe(controller.signal);
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { works: [], total: 0, page: 2, pageSize: 12 } } };
        };
        expect(await listTheatreWorks({ mine: true, q: "", page: 2, pageSize: 12 }, controller.signal)).toEqual({ works: [], total: 0, page: 2, pageSize: 12 });
    } finally {
        apiClient.defaults.adapter = original;
    }
});

test("短剧查询与详情传递类型、取消信号和完整选集数据", async () => {
    const original = apiClient.defaults.adapter;
    const controller = new AbortController();
    const detail = {
        work: { id: "drama", kind: "short_drama", episodeCount: 2 },
        episodes: [
            { id: "episode-1", number: 1 },
            { id: "episode-2", number: 2 },
        ],
    };
    try {
        apiClient.defaults.adapter = async (config) => {
            expect(config.signal).toBe(controller.signal);
            if (config.url === "/theatre/works") {
                expect(config.params).toEqual({ kind: "short_drama", page: 1, pageSize: 12 });
                return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { works: [], total: 0 } } };
            }
            expect(config.url).toBe("/theatre/works/drama%2F1");
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: detail } };
        };
        await listTheatreWorks({ kind: "short_drama", page: 1, pageSize: 12 }, controller.signal);
        expect(await getTheatreWork("drama/1", controller.signal)).toEqual(detail);
    } finally {
        apiClient.defaults.adapter = original;
    }
});

test("多集上传保留集数顺序，编辑剧集提交版本且保留冲突错误", async () => {
    const original = apiClient.defaults.adapter;
    const episodes = [
        { resourceId: "second", title: "第二段" },
        { resourceId: "first", title: "第一段" },
    ];
    const payloads: unknown[] = [];
    try {
        apiClient.defaults.adapter = async (config) => {
            payloads.push(JSON.parse(config.data));
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { work: { id: "drama" }, id: "drama" } } };
        };
        await createTheatreWork({ kind: "short_drama", title: "短剧", description: "", episodes, isComplete: false });
        await updateTheatreWork("drama", { title: "短剧", description: "", episodes, isComplete: true, expectedUpdatedAt: "revision" });
        expect(payloads).toEqual([
            { kind: "short_drama", title: "短剧", description: "", episodes, isComplete: false },
            { title: "短剧", description: "", episodes, isComplete: true, expectedUpdatedAt: "revision" },
        ]);
        apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 409, reason: "conflict", msg: "作品已变化" } });
        await expect(updateTheatreWork("drama", { title: "短剧", description: "", episodes, expectedUpdatedAt: "old" })).rejects.toMatchObject({ code: 409, reason: "conflict" });
    } finally {
        apiClient.defaults.adapter = original;
    }
});

test("分集播放 URL 同时约束作品和剧集，并保留不带连字符的服务端 ID", () => {
    expect(theatreEpisodeVideoUrl("work/1", "episode/2")).toBe("/api/theatre/works/work%2F1/episodes/episode%2F2/video");
    expect(theatreEpisodeVideoUrl("abc123", "def456")).toBe("/api/theatre/works/abc123/episodes/def456/video");
});

test("剧场写操作保留业务失败与权限原因，不伪造发布成功", async () => {
    const original = apiClient.defaults.adapter;
    try {
        apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 403, data: null, msg: "只能管理自己的作品", reason: "forbidden" } });
        for (const operation of [() => createTheatreWork({ resourceId: "resource", title: "作品", description: "" }), () => updateTheatreWork("work", { title: "作品", description: "" }), () => deleteTheatreWork("work")]) {
            try {
                await operation();
                throw new Error("write unexpectedly succeeded");
            } catch (error) {
                expect(error).toBeInstanceOf(ApiError);
                expect((error as ApiError).reason).toBe("forbidden");
            }
        }
    } finally {
        apiClient.defaults.adapter = original;
    }
});

test("共享播放使用作品入口并编码 ID", () => {
    expect(theatreVideoUrl("work/1")).toBe("/api/theatre/works/work%2F1/video");
});

test("封面通过作品共享入口读取，更换时按作品版本刷新", () => {
    expect(theatreCoverUrl("work/1")).toBe("/api/theatre/works/work%2F1/cover");
    expect(theatreCoverUrl("work/1", "2026-10-08T10:00:00+08:00")).toBe("/api/theatre/works/work%2F1/cover?v=2026-10-08T10%3A00%3A00%2B08%3A00");
});

test("编辑封面区分保留、更换与显式移除", async () => {
    const original = apiClient.defaults.adapter;
    const payloads: unknown[] = [];
    try {
        apiClient.defaults.adapter = async (config) => {
            payloads.push(JSON.parse(config.data));
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { id: "work" } } };
        };
        await updateTheatreWork("work", { title: "作品", description: "" });
        await updateTheatreWork("work", { title: "作品", description: "", coverResourceId: "image" });
        await updateTheatreWork("work", { title: "作品", description: "", coverResourceId: "" });
        expect(payloads).toEqual([
            { title: "作品", description: "" },
            { title: "作品", description: "", coverResourceId: "image" },
            { title: "作品", description: "", coverResourceId: "" },
        ]);
    } finally {
        apiClient.defaults.adapter = original;
    }
});
