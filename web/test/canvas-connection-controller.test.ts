import { expect, test } from "bun:test";
import { runTestHarness } from "./helpers/run-test-harness";

// React DOM 的环境检测需要在独立进程中先安装 DOM，避免受其他 SSR 用例影响。
test("真实连接控制器的悬停、释放、取消及重叠节点回归", async () => {
    const result = await runTestHarness("canvas-connection-controller");
    expect(result.exitCode, result.output).toBe(0);
}, 25_000);
