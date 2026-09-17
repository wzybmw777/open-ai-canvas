import { expect, test } from "bun:test";

test("project assets expose and confirm every pending candidate category", async () => {
    const [assetsSource, overviewSource] = await Promise.all([Bun.file(new URL("../src/pages/projects/detail/assets.tsx", import.meta.url)).text(), Bun.file(new URL("../src/pages/projects/detail/overview.tsx", import.meta.url)).text()]);
    const queryStart = assetsSource.indexOf("const candidatesQuery = useQuery({");
    const queryEnd = assetsSource.indexOf("const assets =", queryStart);
    const candidateQuery = assetsSource.slice(queryStart, queryEnd);

    expect(queryStart).toBeGreaterThanOrEqual(0);
    expect(queryEnd).toBeGreaterThan(queryStart);
    expect(candidateQuery).toContain('status: "pending_confirmation"');
    expect(candidateQuery).not.toContain('category: "character"');
    expect(assetsSource).toContain('searchParams.get("section") === "pending"');
    expect(assetsSource).toContain("待确认候选");
    expect(assetsSource).toContain('category === "environment"');
    expect(assetsSource).toContain('category === "prop"');
    expect(assetsSource).toContain("确认为新{label}");
    expect(overviewSource).toContain("/assets?section=pending");
});
