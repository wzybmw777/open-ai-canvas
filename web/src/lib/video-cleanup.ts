import type { GenerationTask } from "@/services/api/task-center";

export function isVideoCleanupTask(task?: Pick<GenerationTask, "inputJson" | "clientContext">): boolean {
    if (task?.clientContext?.videoCleanup) return true;
    try {
        const metadata = JSON.parse(task?.inputJson || "{}").metadata;
        return metadata?.source === "workbench" && metadata?.workbenchKind === "video" && metadata.edit === "remove_watermark";
    } catch { return false; }
}
