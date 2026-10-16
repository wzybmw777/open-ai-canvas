import { Button } from "antd";
import { ProjectContextBar } from "@/components/project-context-bar";
import { useLocaleText } from "@/lib/i18n";

export function CreationProjectContext({ projectId, locked, onChange, onNew }: { projectId?: string; locked: boolean; onChange: (id: string) => void; onNew: () => void }) {
    const { text } = useLocaleText();
    return <ProjectContextBar projectId={projectId} disabled={locked} onChange={onChange}
        action={locked && !projectId ? <Button onClick={onNew}>{text("新建创作", "New creation")}</Button> : undefined}
        description={locked && !projectId ? text("这段历史对话未关联项目。新建创作后选择项目即可输入内容。", "This previous conversation has no project. Start a new creation and choose a project to enter a prompt.") : locked ? text("当前对话的项目已固定；新建创作可选择其他项目。", "This conversation stays in its project. Start a new creation to choose another.") : !projectId ? text("请先选择创作项目，再输入内容或添加参考素材。", "Choose a project before entering a prompt or adding references.") : ""} />;
}
