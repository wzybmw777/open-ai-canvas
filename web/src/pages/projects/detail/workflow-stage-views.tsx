import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Film, Layers3, PackageCheck } from "lucide-react";
import { Link } from "react-router";

import { ASSET_CATEGORIES } from "@/lib/asset-category";
import { useLocaleText } from "@/lib/i18n";
import { listProjectAssetsPage, type ProjectDetail } from "@/services/api/projects";

import { assetCategoryLabel, formatDuration, MetricCard, StageHeading } from "./workflow-shared";

export function StoryStage({ detail, projectId, unitId }: { detail: ProjectDetail; projectId: string; unitId: string }) {
    const { text } = useLocaleText();
    const unit = detail.units.find((item) => item.id === unitId)!;
    return <section className="mx-auto max-w-5xl"><StageHeading eyebrow={text("01 / 剧情与章节", "01 / Story & Chapters")} title={unit.title} description={text("章节原文是资产拆分、分镜版本和生成提示的唯一来源。", "Chapter text is the source for assets, storyboard versions and generation prompts.")} /><div className="mt-6 rounded-xl border border-border/70 bg-surface p-5"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-foreground/55">{text("章节原文", "Chapter text")}</span><Link to={`/projects/${projectId}/chapters/${unit.id}`}><Button size="small">{text("编辑章节", "Edit chapter")}</Button></Link></div><div className="max-h-[60vh] whitespace-pre-wrap text-sm leading-7 text-foreground/78">{unit.sourceText || text("当前章节还没有正文。请先在剧情章节中上传小说或添加内容。", "This chapter has no text yet. Import a novel or add content in Chapters.")}</div></div></section>;
}

export function AssetsStage({ detail, projectId, unitId }: { detail: ProjectDetail; projectId: string; unitId: string }) {
    const { text } = useLocaleText();
    const candidates = detail.assetCandidates.filter((item) => !item.unitId || item.unitId === unitId);
    const assetCountsQuery = useQuery({ queryKey: ["project", projectId, "assets", "workflow-counts"], queryFn: () => listProjectAssetsPage(projectId, { page: 1, pageSize: 1 }) });
    const confirmedCounts = assetCountsQuery.data?.categoryCounts || {};
    return <section className="mx-auto max-w-6xl"><StageHeading eyebrow={text("02 / 资产拆分", "02 / Asset breakdown")} title={text("确认镜头真正会使用的资产", "Confirm assets used by your shots")} description={text("角色、场景、道具、素材与其他资产先建立稳定版本，镜头再绑定具体版本。", "Create stable versions of characters, locations, props and media before linking them to shots.")} /><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{ASSET_CATEGORIES.map((category) => { const confirmed = confirmedCounts[category] || 0; const pending = candidates.filter((item) => item.category === category && item.status === "pending_confirmation").length; return <div key={category} className="border-t border-border/70 py-4"><div className="text-xs font-medium text-foreground/55">{assetCategoryLabel(category)}</div><div className="mt-3 text-2xl font-semibold">{assetCountsQuery.isLoading ? "-" : confirmed}</div><div className="mt-1 text-[var(--fs-micro)] text-foreground/42">{text(`已确认 · ${pending} 待处理`, `Confirmed · ${pending} pending`)}</div></div>; })}</div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-border/70 py-5"><div><h3 className="text-sm font-semibold">{text("资产库承担版本确认与设定维护", "Manage asset versions and details in the library")}</h3><p className="mt-1 text-xs text-foreground/48">{text("确认后可直接在分镜工作台左栏绑定到镜头。", "Once confirmed, assets can be linked to shots from the storyboard workspace.")}</p></div><Link to={`/projects/${projectId}/assets`}><Button type="primary">{text("打开资产库", "Open asset library")}</Button></Link></div></section>;
}

export function DeliveryStage({ detail, unitId }: { detail: ProjectDetail; unitId: string }) {
    const { text } = useLocaleText();
    const shots = detail.shots.filter((item) => item.unitId === unitId);
    const readyVideos = shots.filter((shot) =>
        detail.shotArtifacts.some((item) => item.shotId === shot.id && item.type === "video" && item.selected && item.status === "ready"),
    );
    const stale = detail.shotArtifacts.filter((item) => item.unitId === unitId && item.status === "stale").length;

    return (
        <section className="mx-auto max-w-5xl">
            <StageHeading
                eyebrow={text("06 / 交付与打包", "06 / Delivery")}
                title={text("交付前质量门禁", "Delivery readiness")}
                description={text("所有镜头视频就绪、过期产物清零后，再打包成片与生产资料。", "Review all shot videos and outdated outputs before packaging the final film and production files.")}
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <MetricCard icon={<Film className="size-5" />} label={text("视频已就绪", "Videos ready")} value={`${readyVideos.length} / ${shots.length}`} />
                <MetricCard
                    icon={<Clock3 className="size-5" />}
                    label={text("总时长", "Total duration")}
                    value={formatDuration(shots.reduce((total, item) => total + item.durationMs, 0))}
                />
                <MetricCard icon={<Layers3 className="size-5" />} label={text("过期产物", "Outdated outputs")} value={String(stale)} />
            </div>
            <div className="mt-5 border-y border-border/70 py-5">
                <div className="flex items-start gap-3">
                    <PackageCheck className="mt-0.5 size-5 text-[var(--workspace-accent)]" />
                    <div>
                        <h3 className="text-sm font-semibold">{text("计划交付内容", "Planned deliverables")}</h3>
                        <p className="mt-1 text-xs leading-5 text-foreground/48">
                            {text("成片 MP4、字幕 SRT、分镜 JSON/CSV、资产清单和生成参数 ZIP。", "Final MP4, SRT subtitles, storyboard JSON/CSV, asset manifest and generation settings ZIP.")}
                        </p>
                    </div>
                </div>
                <p className="mt-5 text-xs leading-5 text-foreground/48">
                    {text("当前版本只提供交付前检查，不提供交付包生成入口；待后端打包任务、产物存储和下载权限具备后再开放导出。", "This version provides delivery checks only. Export will be available when packaging, storage and download permissions are ready.")}
                </p>
            </div>
        </section>
    );
}
