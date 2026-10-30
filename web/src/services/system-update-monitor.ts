import type { PublicSystemUpdateStatus } from "./api/system-update";

export type SystemUpdateNoticeState = "idle" | "updating" | "unavailable" | "restored";

export function createSystemUpdateMonitor(probe: (signal: AbortSignal) => Promise<PublicSystemUpdateStatus>) {
    let state: SystemUpdateNoticeState = "idle";
    let running = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let pending: Promise<void> | undefined;
    const listeners = new Set<() => void>();
    const update = (next: SystemUpdateNoticeState) => {
        if (state === next) return;
        state = next;
        listeners.forEach((listener) => listener());
    };
    const check = (): Promise<void> => {
        if (!running) return Promise.resolve();
        if (pending) return pending;
        const currentGeneration = generation;
        const request = new AbortController();
        controller = request;
        // Defer the probe so pending is assigned before even a synchronous failure settles.
        const promise = Promise.resolve().then(() => probe(request.signal)).then((status) => {
            if (request.signal.aborted || generation !== currentGeneration) return;
            if (status.updating) update("updating");
            else if (state === "updating" || state === "unavailable") update("restored");
        }).catch(() => {
            if (request.signal.aborted || generation !== currentGeneration) return;
            if (state !== "updating") update("unavailable");
        }).finally(() => {
            if (pending === promise) pending = undefined;
        });
        pending = promise;
        return promise;
    };
    return {
        getSnapshot: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        check,
        dismiss() {
            if (state === "restored") update("idle");
        },
        start() {
            running = true;
            const currentGeneration = ++generation;
            const poll = async () => {
                await check();
                if (running && generation === currentGeneration) timer = setTimeout(poll, 10000);
            };
            void poll();
            return () => {
                running = false;
                generation++;
                clearTimeout(timer);
                controller?.abort();
                pending = undefined;
            };
        },
    };
}
