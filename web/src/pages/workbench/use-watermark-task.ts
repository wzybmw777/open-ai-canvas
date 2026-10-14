import { useSearchParams } from "react-router";

type WatermarkKind = "image" | "video";

export function watermarkTaskSearchParams(current: URLSearchParams, kind: WatermarkKind, taskID: string) {
    const next = new URLSearchParams(current);
    const key = `${kind}Task`;
    if (taskID) next.set(key, taskID);
    else next.delete(key);
    return next;
}

export function useWatermarkTask(kind: WatermarkKind) {
    const [params, setParams] = useSearchParams();
    return {
        taskID: params.get(`${kind}Task`) || "",
        setTaskID: (taskID: string) => setParams((current) => watermarkTaskSearchParams(current, kind, taskID)),
    };
}
