import { expect, spyOn, test } from "bun:test";
import localforage from "localforage";
import { readTheatreWatchProgress, saveTheatreWatchProgress } from "../src/pages/theatre/theatre-watch-progress";

test("同一剧集的续播记录按用户隔离，损坏记录不产生非法跳转", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {} } });
    const records = new Map<string, string>();
    const get = spyOn(localforage, "getItem").mockImplementation(async (key) => records.get(key) || null);
    const set = spyOn(localforage, "setItem").mockImplementation(async (key, value) => {
        records.set(key, String(value));
        return value;
    });
    try {
        await saveTheatreWatchProgress("author", "drama", { episodeId: "episode-2", seconds: 12.5 });
        expect(await readTheatreWatchProgress("author", "drama")).toEqual({ episodeId: "episode-2", seconds: 12.5 });
        expect(await readTheatreWatchProgress("viewer", "drama")).toBeNull();
        records.set("theatre-watch:drama:user:viewer", '{"episodeId":"episode-2","seconds":-1}');
        expect(await readTheatreWatchProgress("viewer", "drama")).toBeNull();
        records.set("theatre-watch:drama:user:viewer", "corrupted");
        expect(await readTheatreWatchProgress("viewer", "drama")).toBeNull();
    } finally {
        get.mockRestore();
        set.mockRestore();
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
