import { expect, test } from "bun:test";
import { createSystemUpdateMonitor } from "../src/services/system-update-monitor";

test("retains the update notice through downtime and offers refresh only after recovery", async () => {
    const responses: Array<{ updating: boolean } | Error> = [
        { updating: false }, { updating: true }, new Error("backend restarting"),
        { updating: true }, { updating: false }, { updating: false },
    ];
    const monitor = createSystemUpdateMonitor(async () => {
        const response = responses.shift()!;
        if (response instanceof Error) throw response;
        return response;
    }, async () => ({ ready: false }));
    const stop = monitor.start();
    try {
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("idle");
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("updating");
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("updating");
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("updating");
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("restored");
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("restored");
        monitor.dismiss();
        expect(monitor.getSnapshot()).toBe("idle");
    } finally { stop(); }
});

test("does not call an unknown outage a confirmed update", async () => {
    let online = false;
    const monitor = createSystemUpdateMonitor(async () => {
        if (!online) throw new Error("offline");
        return { updating: false };
    }, async () => ({ ready: false }));
    const stop = monitor.start();
    try {
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("unavailable");
        online = true;
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("restored");
    } finally { stop(); }
});

test("deduplicates concurrent probes and ignores a stopped request after remount", async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (status: { updating: boolean }) => void }> = [];
    const monitor = createSystemUpdateMonitor((signal) => new Promise((resolve) => pending.push({ signal, resolve })), async () => ({ ready: false }));
    const stop = monitor.start();
    const first = monitor.check();
    expect(monitor.check()).toBe(first);
    await Promise.resolve();
    expect(pending).toHaveLength(1);
    stop();
    expect(pending[0].signal.aborted).toBe(true);
    const stopAgain = monitor.start();
    try {
        const current = monitor.check();
        await Promise.resolve();
        pending[1].resolve({ updating: true });
        await current;
        pending[0].resolve({ updating: false });
        await first;
        expect(monitor.getSnapshot()).toBe("updating");
    } finally { stopAgain(); }
});

test("readiness does not declare a confirmed update finished when the updater is unreachable", async () => {
    let reachable = true;
    const monitor = createSystemUpdateMonitor(async () => {
        if (!reachable) throw new Error("updater unreachable");
        return { updating: true };
    }, async () => ({ ready: true }));
    const stop = monitor.start();
    try {
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("updating");
        reachable = false;
        await monitor.check();
        expect(monitor.getSnapshot()).toBe("updating");
    } finally { stop(); }
});

test("a canceled readiness probe cannot overwrite a newly mounted monitor", async () => {
    let updateReachable = false;
    let resolveReadiness!: (status: { ready: boolean }) => void;
    let readinessSignal!: AbortSignal;
    const monitor = createSystemUpdateMonitor(async () => {
        if (!updateReachable) throw new Error("updater unreachable");
        return { updating: true };
    }, (signal) => new Promise((resolve) => { readinessSignal = signal; resolveReadiness = resolve; }));
    const stop = monitor.start();
    const first = monitor.check();
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    expect(readinessSignal.aborted).toBe(true);
    updateReachable = true;
    const stopAgain = monitor.start();
    try {
        await monitor.check();
        resolveReadiness({ ready: false });
        await first;
        expect(monitor.getSnapshot()).toBe("updating");
    } finally { stopAgain(); }
});
