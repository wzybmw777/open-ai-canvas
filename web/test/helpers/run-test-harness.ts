import { spawn } from "node:child_process";
import { resolve } from "node:path";

/** Keep browser globals and module mocks inside their own bounded process. */
export function runTestHarness(name: string, timeoutMs = 20_000, testTimeoutMs = 5_000): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolveResult, reject) => {
        const child = spawn(process.execPath, ["test", "--timeout", String(testTimeoutMs), `./test/fixtures/${name}.harness.tsx`], {
            cwd: resolve(import.meta.dir, "../.."),
            timeout: timeoutMs,
            killSignal: "SIGKILL",
            stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (data) => {
            output += data.toString();
        });
        child.stderr.on("data", (data) => {
            output += data.toString();
        });
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolveResult({ exitCode, output: signal ? `${output}\nHarness terminated by ${signal}` : output }));
    });
}
