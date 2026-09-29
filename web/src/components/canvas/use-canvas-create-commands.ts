import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "@/lib/canvas/tool-registry";
import { useLocaleText } from "@/lib/i18n";
import { usePluginStore } from "@/stores/use-plugin-store";

import type { CanvasCreateCommand } from "./canvas-create-menu";

export function useCanvasCreateCommands(context: AddNodeMenuContext, runCommand?: (command: () => void) => void): CanvasCreateCommand[] {
    const { locale } = useLocaleText();
    const installations = usePluginStore((state) => state.installations);
    const pluginStates = usePluginStore((state) => state.pluginStates);
    const enabledPluginIds = new Set(installations.filter((item) => pluginStates[item.manifest.id]?.effectiveEnabled ?? item.enabled).map((item) => item.manifest.id));

    return resolveAddNodeMenuCommands({ ...context, enabledPluginIds }).map((command) => ({
        id: command.id,
        label: locale === "en-US" ? englishCreateCommandLabels[command.id] || command.label : command.label,
        icon: command.icon,
        badge: locale === "en-US" ? (command.badge === "核心" ? "Core" : command.badge === "本地" ? "Local" : command.badge === "6 款" ? "6 styles" : command.badge) : command.badge,
        section: command.section,
        onClick: () => {
            const run = () => command.run(context);
            if (runCommand) runCommand(run);
            else run();
        },
    }));
}

const englishCreateCommandLabels: Record<string, string> = {
    style: "Project style",
    text: "Text",
    drawing: "Drawing",
    script: "Storyboard script",
    frame: "Frame",
    folder: "Folder",
    image: "Image",
    video: "Video",
    "batch-table": "Batch creation",
    "media-conversion": "Convert media",
    director: "Director desk",
    audio: "Audio",
    workflow: "Workflow",
    upload: "Upload files",
    "project-character": "Add character",
    assets: "Asset library",
};
