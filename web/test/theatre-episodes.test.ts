import { expect, test } from "bun:test";
import { episodeDraftsFromFiles, isTheatreVideoFile, moveEpisode } from "../src/pages/theatre/theatre-episode-drafts";

test("批量添加按集数自然排序，不按字符串将第10集放在第2集之前", () => {
    const files = ["第10集.mp4", "第2集.mp4", "第01集.mp4"].map((name) => new File(["video"], name, { type: "video/mp4" }));
    const drafts = episodeDraftsFromFiles(files);
    expect(drafts.map((draft) => draft.title)).toEqual(["第01集", "第2集", "第10集"]);
    expect(files.map((file) => file.name)).toEqual(["第10集.mp4", "第2集.mp4", "第01集.mp4"]);
    expect(new Set(drafts.map((draft) => draft.key)).size).toBe(3);
    expect(drafts[2].file).toBe(files[0]);
});

test("调整顺序保持视频与标题关联，边界移动保留原顺序", () => {
    const drafts = [
        { key: "a", resourceId: "first", title: "开场" },
        { key: "b", resourceId: "second", title: "结尾" },
    ];
    expect(moveEpisode(drafts, 0, -1)).toBe(drafts);
    expect(moveEpisode(drafts, 1, 1)).toBe(drafts);
    expect(moveEpisode(drafts, 1, -1)).toEqual([drafts[1], drafts[0]]);
    expect(drafts[0].resourceId).toBe("first");
});

test("拒绝空文件和非视频，允许浏览器没有 MIME 信息的视频扩展名", () => {
    expect(isTheatreVideoFile(new File([], "空.mp4", { type: "video/mp4" }))).toBe(false);
    expect(isTheatreVideoFile(new File(["image"], "poster.png", { type: "image/png" }))).toBe(false);
    expect(isTheatreVideoFile(new File(["video"], "episode.MOV"))).toBe(true);
    expect(isTheatreVideoFile(new File(["video"], "episode.webm", { type: "video/webm" }))).toBe(true);
});
