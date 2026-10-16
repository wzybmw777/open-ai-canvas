import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { loadInspirationCatalog } from "../src/services/inspiration-catalog";
import { curatedInspirations, type CreationInspiration } from "../src/lib/inspirations/catalog";

describe("inspiration catalog loading", () => {
    test("fills source pages from existing local covers, preserves entries, and shares successful loads", async () => {
        const originalFetch = globalThis.fetch;
        const requests: string[] = [];
        let fail = true;
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            requests.push(url);
            if (fail && url.endsWith("seedance.json")) return new Response("", { status: 503 });
            const body = readFileSync(new URL(`../public${url}`, import.meta.url), "utf8");
            return new Response(body, { headers: { "Content-Type": "application/json" } });
        }) as typeof fetch;
        try {
            await expect(loadInspirationCatalog()).rejects.toThrow("503");
            fail = false;
            const firstLoad = loadInspirationCatalog();
            expect(loadInspirationCatalog()).toBe(firstLoad);
            const catalog = await firstLoad;
            let total = curatedInspirations.length;
            for (const source of ["seedance", "haohaoxue", "youmind"]) {
                const { entries: original } = JSON.parse(readFileSync(new URL(`../public/inspirations/${source}.json`, import.meta.url), "utf8")) as { entries: CreationInspiration[] };
                const entries = catalog.entries.filter((item) => item.sourceId === source);
                total += original.length;
                expect(entries).toHaveLength(original.length);
                expect(entries.slice(0, 24).every((entry) => entry.image.startsWith("/inspiration-thumbs/"))).toBe(true);
                expect(new Map(entries.map((entry) => [entry.id, entry]))).toEqual(new Map(original.map((entry) => [entry.id, entry])));
                expect(entries.filter((entry) => entry.image.startsWith("/"))).toEqual(original.filter((entry) => entry.image.startsWith("/")));
                expect(entries.filter((entry) => !entry.image.startsWith("/"))).toEqual(original.filter((entry) => !entry.image.startsWith("/")));
            }
            expect(catalog.entries).toHaveLength(total);
            expect(catalog.entries.slice(-curatedInspirations.length)).toEqual(curatedInspirations);
            const requestCount = requests.length;
            expect(await loadInspirationCatalog()).toBe(catalog);
            expect(requests).toHaveLength(requestCount);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
