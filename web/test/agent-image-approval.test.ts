import { expect, test } from "bun:test";
import { runTestHarness } from "./helpers/run-test-harness";

test("真实 React 图片审批多字段更新不会覆盖已选宽高比", async () => {
    const result = await runTestHarness("agent-image-approval");
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain("1 pass");
    expect(result.output).toContain("0 fail");
}, 25_000);
