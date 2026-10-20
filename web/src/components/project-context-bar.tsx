import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { Link } from "react-router";
import { listRemoteCanvasProjects } from "@/services/api/user-data";
import { ensureDefaultCreationProject } from "@/services/creation-project";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { useLocaleText } from "@/lib/i18n";
import "./project-context-bar.css";

export function ProjectContextBar({ projectId, disabled, onChange, description, action }: { projectId?: string; disabled?: boolean; onChange: (id: string) => void; description: string; action?: ReactNode }) {
    const { text } = useLocaleText();
    const userId = useUserStore((state) => state.user?.id);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useQuery({
        queryKey: ["canvas-library", userId, "creation-context"],
        queryFn: async () => {
            const defaultId = await ensureDefaultCreationProject();
            const result = await listRemoteCanvasProjects();
            if (!result.projects.some((project) => project.id === defaultId)) throw new Error("默认项目已不可用，请重试");
            return { ...result, defaultId };
        },
        enabled: Boolean(userId) && hydrated,
        refetchOnMount: "always",
    });
    useEffect(() => {
        // Cached IDs may have been deleted in another view; wait for the fresh server result.
        if (!userId || disabled || !projects.isSuccess || projects.isFetching) return;
        if (!projectId || !projects.data.projects.some((project) => project.id === projectId)) onChange(projects.data.defaultId);
    }, [userId, projectId, disabled, projects.isSuccess, projects.isFetching, projects.data, onChange]);
    return <section className="project-context-bar" aria-label={text("当前创作项目", "Creation project")}>
        <div className="project-context-controls">
            <span>{text("所属项目", "Project")}</span>
            <Select aria-label={text("选择创作项目", "Choose a project")} placeholder={text("选择项目", "Choose a project")}
                value={projectId || undefined} onChange={onChange} showSearch={{ optionFilterProp: "label" }}
                options={(projects.data?.projects || []).map((project) => ({ value: project.id, label: project.title }))}
                loading={projects.isPending && Boolean(userId)} disabled={!userId || disabled || projects.isError}
                notFoundContent={text("正在准备默认项目", "Preparing your default project")} />
            {action || <Link to="/projects">{text("打开项目", "Open project")}</Link>}
        </div>
        {projects.isError ? <p role="alert">{text("项目准备失败，请重试。", "Could not prepare projects. Try again.")} <Button size="small" onClick={() => void projects.refetch()}>{text("重试", "Retry")}</Button></p> : description ? <p>{description}</p> : null}
    </section>;
}
