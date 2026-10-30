import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("managed source updates disable Vite reload while ordinary development keeps HMR", () => {
    for (const [flag, expected] of [["true", false], ["", "default"]] as const) {
        const result = Bun.spawnSync([process.execPath, "--eval", 'const { default: config } = await import("./vite.config.ts"); console.log(JSON.stringify({hmr: config.server.hmr ?? "default"})); process.exit(0);'], {
            cwd: fileURLToPath(new URL("..", import.meta.url)),
            env: { ...process.env, VITE_MANAGED_SOURCE_UPDATES: flag },
        });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(new TextDecoder().decode(result.stdout)).hmr).toBe(expected);
    }
}, 30000);
