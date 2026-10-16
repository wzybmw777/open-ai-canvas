import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { Link } from "react-router";
import { listProjects } from "@/services/api/projects";
import { useUserStore } from "@/stores/use-user-store";
import { useLocaleText } from "@/lib/i18n";
import "./project-context-bar.css";

export function ProjectContextBar({ projectId, disabled, onChange, description, action }: { projectId?: string; disabled?: boolean; onChange: (id: string) => void; description: string; action?: ReactNode }) {
    const { text } = useLocaleText();
    const userId = useUserStore((state) => state.user?.id);
    const projects = useQuery({ queryKey: ["projects", "context", userId], queryFn: () => listProjects(), enabled: Boolean(userId) });
    return <section className="project-context-bar" aria-label={text("当前创作项目", "Creation project")}>
        <div className="project-context-controls">
            <span>{text("所属项目", "Project")}</span>
            <Select aria-label={text("选择创作项目", "Choose a project")} placeholder={text("选择项目", "Choose a project")}
                value={projectId || undefined} onChange={onChange} showSearch={{ optionFilterProp: "label" }}
                options={(projects.data?.projects || []).map(({ project }) => ({ value: project.id, label: project.name, disabled: project.status !== "active" }))}
                loading={projects.isPending && Boolean(userId)} disabled={!userId || disabled || projects.isError}
                notFoundContent={text("暂无可用项目，请先新建项目", "Create a project to get started")} />
            {action || (projectId ? <Link to={`/projects/${encodeURIComponent(projectId)}/overview`}>{text("打开项目", "Open project")}</Link> : <Link to="/projects?create=1">{text("新建项目", "New project")}</Link>)}
        </div>
        {projects.isError ? <p role="alert">{text("项目列表加载失败。", "Could not load projects.")} <Button size="small" onClick={() => void projects.refetch()}>{text("重试", "Retry")}</Button></p> : <p>{description}</p>}
    </section>;
}
