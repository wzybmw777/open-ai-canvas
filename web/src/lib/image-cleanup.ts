import type { GenerationTask } from "@/services/api/task-center";

export function isImageCleanupTask(task?: Pick<GenerationTask, "inputJson" | "clientContext">): boolean {
    if (task?.clientContext?.imageCleanup) return true;
    try {
        const metadata = JSON.parse(task?.inputJson || "{}").metadata;
        return metadata?.source === "workbench" && metadata?.workbenchKind === "image" && metadata.edit === "remove_watermark";
    } catch { return false; }
}
