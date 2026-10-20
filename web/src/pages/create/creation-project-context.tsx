import { Button } from "antd";
import { ProjectContextBar } from "@/components/project-context-bar";
import { useLocaleText } from "@/lib/i18n";

export function CreationProjectContext({ canvasId, locked, onChange, onNew }: { canvasId?: string; locked: boolean; onChange: (id: string) => void; onNew: () => void }) {
    const { text } = useLocaleText();
    return <ProjectContextBar projectId={canvasId} disabled={locked} onChange={onChange}
        action={locked && !canvasId ? <Button onClick={onNew}>{text("新建创作", "New creation")}</Button> : undefined}
        description={locked && !canvasId ? text("这段历史对话未关联画布项目，请新建创作后继续。", "This conversation has no canvas project. Start a new creation to continue.") : ""} />;
}
