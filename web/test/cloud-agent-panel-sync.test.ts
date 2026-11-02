import { expect, test } from "bun:test";
import { runTestHarness } from "./helpers/run-test-harness";

test("真实工作区面板跨设备发现、接续与账号隔离", async () => {
    const { exitCode, output } = await runTestHarness("cloud-agent-panel-sync", 30_000);
    expect(exitCode, output).toBe(0);
    expect(output).toContain("15 pass");
    expect(output).toContain("0 fail");
}, 35_000);
