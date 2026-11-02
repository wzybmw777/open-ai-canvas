import { expect, test } from "bun:test";
import { runTestHarness } from "./helpers/run-test-harness";

test("task details and media recovery use the existing server task and propagate failures", async () => {
    // Cold imports can block on shared storage before Bun starts a test timer.
    const result = await runTestHarness("task-drawer-navigation", 120_000, 15_000);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("4 pass");
    expect(result.output).toContain("0 fail");
}, 125_000);
