import { ArrowRight, BookOpenText, CheckCircle2, CircleAlert, Clapperboard, Clock3, Film, PackageCheck, PlaySquare, Scissors, UsersRound } from "lucide-react";
import { Link } from "react-router";

import { WorkspaceState } from "@/components/layout/workspace-state";
import type { ProjectStageCell, ProjectWorkbenchAction } from "@/lib/project-workbench";
import type { ProjectOverview, ProjectOverviewMetrics } from "@/services/api/projects";
import { useLocaleText, type AppLocale } from "@/lib/i18n";

import { formatTime, type ProjectDetailViewProps } from "./shared";

export default function ProjectOverviewView({ detail, overview }: ProjectDetailViewProps & { overview: ProjectOverview }) {
    const { locale, text } = useLocaleText();
    const { project } = detail;
    const metrics = overview.metrics;
    const completedUnits = metrics.completedUnitCount;
    const attentionCount = metrics.pendingCandidateCount + metrics.staleArtifactCount;
    const completion = metrics.unitCount ? Math.round((completedUnits / metrics.unitCount) * 100) : 0;
    const firstUnitId = detail.units.slice().sort((left, right) => left.position - right.position)[0]?.id || overview.units[0]?.unit.id;
    const workflowHref = (targetStage: string) => firstUnitId ? `/projects/${project.id}/workflow/${firstUnitId}/${targetStage}` : `/projects/${project.id}/chapters`;
    const stage = overviewStage(metrics, locale);
    const actions = overviewActions(project.id, metrics, firstUnitId, locale).slice(0, 3);
    const primaryAction = actions[0];
    const secondaryActions = actions.slice(1);
    const unitStages = overview.units.map((item) => ({
        unit: item.unit,
        content: stageCell(item.unit.wordCount > 0, item.unit.wordCount > 0 ? locale === "en-US" ? `${formatCompactCount(item.unit.wordCount, locale)} words` : `${formatCompactCount(item.unit.wordCount, locale)} 字` : text("待补充", "Needs text")),
        assets: stageCell(item.candidateCount === 0 && item.shotCount > 0, item.candidateCount ? locale === "en-US" ? `${item.candidateCount} to confirm` : `${item.candidateCount} 待确认` : item.shotCount ? text("已确认", "Confirmed") : text("待拆分", "Not split"), item.candidateCount > 0),
        storyboard: stageCell(item.shotCount > 0, item.shotCount ? locale === "en-US" ? `${item.shotCount} shots` : `${item.shotCount} 镜` : text("待生成", "Not generated")),
        canvas: stageCell(item.canvasCount > 0, item.canvasCount ? locale === "en-US" ? `${item.canvasCount} canvases` : `${item.canvasCount} 张` : text("未关联", "Not linked")),
    }));
    const productionSteps = [
        { id: "story", icon: BookOpenText, label: text("剧情章节", "Story chapters"), description: text("导入或编写正文，确认每章叙事目标", "Import or write chapters and set each narrative goal"), metric: locale === "en-US" ? `${metrics.unitCount} chapters · ${formatCompactCount(metrics.totalWordCount, locale)} words` : `${metrics.unitCount} 章 · ${formatCompactCount(metrics.totalWordCount, locale)} 字`, href: `/projects/${project.id}/chapters`, complete: metrics.unitCount > 0 },
        { id: "assets", icon: UsersRound, label: text("角色与资产", "Characters and assets"), description: text("确认角色、场景、道具和项目画风", "Confirm characters, locations, props, and visual style"), metric: locale === "en-US" ? `${metrics.assetCount} assets` : `${metrics.assetCount} 项资产`, href: `/projects/${project.id}/assets`, complete: metrics.assetCount > 0 },
        { id: "storyboard", icon: Clapperboard, label: text("分镜脚本与画面", "Storyboard"), description: text("拆分镜头并确认构图、对白和时长", "Split shots and review framing, dialogue, and duration"), metric: locale === "en-US" ? `${metrics.shotCount} shots · ${metrics.readyStoryboardCount} images` : `${metrics.shotCount} 镜 · ${metrics.readyStoryboardCount} 张图`, href: workflowHref("storyboard"), complete: metrics.shotCount > 0 },
        { id: "previz", icon: PlaySquare, label: text("动作预演", "Previsualization"), description: text("检查表演节拍、运镜和连续性", "Review performance timing, camera movement, and continuity"), metric: `${metrics.readyPrevizCount}/${metrics.shotCount || 0} ${text("镜", "shots")}`, href: workflowHref("previz"), complete: metrics.shotCount > 0 && metrics.readyPrevizCount === metrics.shotCount },
        { id: "video", icon: Film, label: text("镜头视频", "Shot videos"), description: text("逐镜生成、筛选版本并锁定成片", "Generate shots, select versions, and lock the final cut"), metric: `${metrics.readyVideoCount}/${metrics.shotCount || 0} ${text("镜", "shots")}`, href: workflowHref("video"), complete: metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount },
        { id: "editor", icon: Scissors, label: text("剪辑成片", "Edit final cut"), description: text("在时间线中编排镜头、添加字幕并输出成片", "Arrange shots on the timeline, add subtitles, and export"), metric: metrics.renderSucceededCount > 0 ? locale === "en-US" ? `${metrics.renderSucceededCount} exports` : `已输出 ${metrics.renderSucceededCount} 个成片` : metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount ? text("可以开始剪辑", "Ready to edit") : locale === "en-US" ? `${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} shots remaining` : `还差 ${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} 镜`, href: `/projects/${project.id}/editor`, complete: metrics.renderSucceededCount > 0 },
        { id: "delivery", icon: PackageCheck, label: text("交付与打包", "Delivery"), description: text("检查缺失镜头并整理最终产物", "Check missing shots and organize final outputs"), metric: metrics.readyVideoCount && metrics.readyVideoCount === metrics.shotCount ? text("可以交付", "Ready to deliver") : locale === "en-US" ? `${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} shots remaining` : `还差 ${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} 镜`, href: workflowHref("delivery"), complete: metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount },
    ];
    const gaps = [
        metrics.unitCount === 0 ? text("还没有剧情章节", "No story chapters yet") : metrics.unitsWithoutText ? locale === "en-US" ? `${metrics.unitsWithoutText} chapters need text` : `${metrics.unitsWithoutText} 章还没有正文` : text("章节正文已就绪", "Chapter text is ready"),
        metrics.pendingCandidateCount ? locale === "en-US" ? `${metrics.pendingCandidateCount} assets await confirmation` : `${metrics.pendingCandidateCount} 项资产等待确认` : metrics.assetCount ? text("项目资产已建立", "Project assets are ready") : text("还没有角色与资产", "No characters or assets yet"),
        metrics.shotCount ? metrics.readyVideoCount === metrics.shotCount ? text("所有镜头视频已生成", "All shot videos are ready") : locale === "en-US" ? `${metrics.shotCount - metrics.readyVideoCount} shots need video` : `${metrics.shotCount - metrics.readyVideoCount} 个镜头尚未生成视频` : text("还没有分镜镜头", "No storyboard shots yet"),
    ];

    return (
        <div className="space-y-8">
            <section className="project-overview-focus">
                <div className="grid lg:grid-cols-[minmax(0,1fr)_308px]">
                    <div className="project-overview-primary">
                        <div className="project-overview-eyebrow">
                            <span>{text("当前任务", "Current task")}</span>
                            <span className="project-overview-eyebrow-divider" aria-hidden>/</span>
                            <span className="project-overview-eyebrow-stage">{stage.label}</span>
                            {attentionCount ? <span className="project-overview-eyebrow-badge">{locale === "en-US" ? `${attentionCount} to review` : `${attentionCount} 项待处理`}</span> : null}
                        </div>
                        <h2 className="project-overview-title">{primaryAction.title}</h2>
                        <p className="project-overview-description">{primaryAction.description}</p>
                        <div className="project-overview-cta">
                            {/* 主按钮走 --btn-solid-* 配对色：原先是 bg-[--workspace-accent] + text-white，
                                而暗色下该 accent 是 #f5f5f5，等于白底白字。 */}
                            <Link to={primaryAction.href} className="project-overview-cta-primary">
                                <span className="truncate">{primaryAction.actionLabel}</span><ArrowRight className="size-4 shrink-0" />
                            </Link>
                            {secondaryActions[0] ? <Link to={secondaryActions[0].href} className="project-overview-cta-secondary">{text("继续下一步", "Next step")}<ArrowRight className="size-3.5" /></Link> : null}
                        </div>
                    </div>

                    <aside className="project-overview-status" aria-label={text("项目进度", "Project progress")}>
                        <div className="project-overview-progress">
                            <div className="project-overview-progress-head">
                                <span className="project-overview-status-label">{text("章节进度", "Chapter progress")}</span>
                                <span className="project-overview-progress-percent">{completion}%</span>
                            </div>
                            <div className="project-overview-progress-count">{completedUnits}<span>/ {metrics.unitCount}</span></div>
                            <div className="project-overview-progress-track" aria-label={locale === "en-US" ? `Chapter completion ${completion}%` : `章节完成度 ${completion}%`}><div style={{ width: `${completion}%` }} /></div>
                        </div>
                        <dl className="project-overview-facts">
                            <ProjectFact label={text("当前阶段", "Current stage")} value={stage.label} />
                            <ProjectFact label={text("分镜镜头", "Shots")} value={locale === "en-US" ? `${metrics.shotCount}` : `${metrics.shotCount} 个`} />
                            <ProjectFact label={text("项目画布", "Canvases")} value={locale === "en-US" ? `${metrics.canvasCount}` : `${metrics.canvasCount} 张`} />
                            <ProjectFact label={text("需要处理", "To review")} value={locale === "en-US" ? `${attentionCount}` : `${attentionCount} 项`} attention={attentionCount > 0} />
                        </dl>
                        {secondaryActions.length ? (
                            <div className="project-overview-next">
                                <span className="project-overview-status-label">{text("随后处理", "Up next")}</span>
                                <div className="mt-2 space-y-0.5">{secondaryActions.map((action) => <SecondaryAction key={action.id} action={action} />)}</div>
                            </div>
                        ) : null}
                    </aside>
                </div>
            </section>

            <section className="project-standard-flow">
                <div className="project-standard-flow-head"><div><span>{text("标准制作流程", "Production workflow")}</span><h2>{text("从章节到可交付镜头", "From chapters to final shots")}</h2><p>{text("先确认故事与资产，再逐镜完成画面、动作和视频。每个步骤都可直接进入对应工作区。", "Confirm the story and assets, then create images, motion, and video for each shot.")}</p></div><Link to={primaryAction.href}>{text("继续当前任务", "Continue current task")}<ArrowRight /></Link></div>
                <div className="project-standard-flow-track">
                    {productionSteps.map((step, index) => { const Icon = step.icon; return <Link key={step.id} to={step.href} className={step.complete ? "is-complete" : ""}><span className="project-standard-flow-index">{step.complete ? <CheckCircle2 /> : index + 1}</span><span className="project-standard-flow-icon"><Icon /></span><strong>{step.label}</strong><p>{step.description}</p><em>{step.metric}</em><ArrowRight className="project-standard-flow-arrow" /></Link>; })}
                </div>
                <div className="project-standard-flow-footer"><div><strong>{text("当前制作检查", "Production check")}</strong>{gaps.map((gap, index) => <span key={gap}><i className={index === 2 && metrics.readyVideoCount !== metrics.shotCount ? "is-attention" : ""} />{gap}</span>)}</div><div><strong>{text("快速入口", "Quick links")}</strong><Link to={`/projects/${project.id}/chapters`}>{text("整理章节", "Edit chapters")}</Link><Link to={`/projects/${project.id}/assets`}>{text("确认资产", "Confirm assets")}</Link><Link to={workflowHref("video")}>{text("继续镜头制作", "Continue shot production")}</Link></div></div>
            </section>

            <section>
                <div className="project-pipeline-head">
                    <div className="min-w-0">
                        <h2 className="project-pipeline-title">{text("章节进度", "Chapter progress")}</h2>
                        <p className="project-pipeline-hint">{text("从内容确认到项目画布，每章只显示当前真实状态。", "Track each chapter from approved text through its linked canvas.")}</p>
                    </div>
                    <Link to={`/projects/${project.id}/chapters`} className="project-pipeline-more">{text("查看全部章节", "View all chapters")}<ArrowRight className="size-3.5" /></Link>
                </div>

                {unitStages.length ? (
                    <div className="project-pipeline-surface">
                        {unitStages.map((item) => (
                            <Link key={item.unit.id} to={`/projects/${project.id}/chapters/${item.unit.id}`} className="project-pipeline-row group">
                                <span className="project-pipeline-chapter">
                                    <span className="project-pipeline-index">{String(item.unit.position + 1).padStart(2, "0")}</span>
                                    <span className="min-w-0"><span className="project-pipeline-chapter-title">{item.unit.title}</span><span className="project-pipeline-chapter-time">{text("更新于", "Updated")} {formatTime(item.unit.updatedAt, locale)}</span></span>
                                </span>
                                <StagePipeline content={item.content} assets={item.assets} storyboard={item.storyboard} canvas={item.canvas} />
                                <ArrowRight className="project-pipeline-arrow size-4" />
                            </Link>
                        ))}
                    </div>
                ) : <div className="project-pipeline-surface p-2"><WorkspaceState icon="projects" compact title={text("还没有剧情章节", "No story chapters yet")} description={text("添加章节后，这里会显示内容、资产、分镜和画布的制作进度。", "Add a chapter to track its text, assets, storyboard, and canvas progress.")} /></div>}
            </section>
        </div>
    );
}

function formatCompactCount(value: number, locale: AppLocale) {
    return locale === "en-US" ? new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value) : value >= 10_000 ? `${Math.round(value / 1_000) / 10} 万` : value.toLocaleString(locale);
}

function ProjectFact({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
    return <div className="min-w-0"><dt>{label}</dt><dd className={attention ? "is-attention" : ""}>{value}</dd></div>;
}

function SecondaryAction({ action }: { action: ProjectWorkbenchAction }) {
    const Icon = action.tone === "danger" ? CircleAlert : action.tone === "attention" ? Clock3 : CheckCircle2;
    return <Link to={action.href} className="project-overview-next-item group"><Icon className={`size-3.5 shrink-0 ${action.tone === "danger" ? "text-foreground/80" : action.tone === "attention" ? "text-foreground/60" : "text-foreground/30"}`} /><span className="min-w-0 flex-1 truncate">{action.title}</span><ArrowRight className="size-3 shrink-0 text-foreground/25 transition group-hover:text-foreground/55" /></Link>;
}

function StagePipeline({ content, assets, storyboard, canvas }: { content: ProjectStageCell; assets: ProjectStageCell; storyboard: ProjectStageCell; canvas: ProjectStageCell }) {
    const { text } = useLocaleText();
    const stages = [{ label: text("内容", "Text"), cell: content }, { label: text("资产", "Assets"), cell: assets }, { label: text("分镜", "Storyboard"), cell: storyboard }, { label: text("画布", "Canvas"), cell: canvas }];
    return (
        <span className="project-pipeline-stages">
            {stages.map(({ label, cell }) => <StageStep key={label} label={label} cell={cell} />)}
        </span>
    );
}

function StageStep({ label, cell }: { label: string; cell: ProjectStageCell }) {
    return (
        <span className={`project-pipeline-stage is-${cell.state}`}>
            <span className="project-pipeline-stage-label">{label}</span>
            <span className="project-pipeline-stage-track" />
            <span className="project-pipeline-stage-value">{cell.label}</span>
        </span>
    );
}

function overviewStage(metrics: ProjectOverviewMetrics, locale: AppLocale) {
    if (!metrics.unitCount) return { label: locale === "en-US" ? "Prepare story" : "准备故事" };
    if (metrics.pendingCandidateCount) return { label: locale === "en-US" ? "Confirm assets" : "资产确认" };
    if (!metrics.shotCount || metrics.unitsWithoutShots) return { label: locale === "en-US" ? "Prepare storyboard" : "分镜准备" };
    if (metrics.readyVideoCount < metrics.shotCount) return { label: locale === "en-US" ? "Produce shots" : "镜头制作" };
    return { label: locale === "en-US" ? "Review delivery" : "检查交付" };
}

function overviewActions(projectId: string, metrics: ProjectOverviewMetrics, firstUnitId: string | undefined, locale: AppLocale): ProjectWorkbenchAction[] {
    const projectRoot = `/projects/${projectId}`;
    const workflowHref = firstUnitId ? `${projectRoot}/workflow/${firstUnitId}/video` : `${projectRoot}/chapters`;
    if (!metrics.unitCount) {
        return [{ id: "add-story", title: locale === "en-US" ? "Add your first story chapter" : "添加第一个剧情章节", description: locale === "en-US" ? "Import a novel, paste text, or start with a blank chapter." : "导入小说、粘贴文本，或从空白章节开始。", href: `${projectRoot}/chapters`, actionLabel: locale === "en-US" ? "Add chapter" : "添加章节", tone: "default" }];
    }
    const actions: ProjectWorkbenchAction[] = [];
    if (metrics.unitsWithoutText) {
        actions.push({ id: "complete-story", title: locale === "en-US" ? `Add text to ${metrics.unitsWithoutText} chapters` : `补充 ${metrics.unitsWithoutText} 章正文`, description: locale === "en-US" ? "Complete chapter text before identifying characters and splitting shots." : "先完善章节内容，后续角色识别与分镜拆分才能获得稳定输入。", href: `${projectRoot}/chapters`, actionLabel: locale === "en-US" ? "Edit chapters" : "整理章节", tone: "attention" });
    }
    if (metrics.pendingCandidateCount) {
        actions.push({ id: "confirm-assets", title: locale === "en-US" ? `Confirm ${metrics.pendingCandidateCount} asset candidates` : `确认 ${metrics.pendingCandidateCount} 个资产候选`, description: locale === "en-US" ? "Confirm characters, locations, and props so shots can reference them." : "确认角色、场景与道具后，镜头可以稳定引用项目资产。", href: `${projectRoot}/assets`, actionLabel: locale === "en-US" ? "Review assets" : "去确认", tone: "attention" });
    }
    if (!metrics.shotCount || metrics.unitsWithoutShots) {
        actions.push({ id: "create-storyboards", title: locale === "en-US" ? `Create storyboards for ${metrics.unitsWithoutShots || metrics.unitCount} chapters` : `为 ${metrics.unitsWithoutShots || metrics.unitCount} 章建立分镜`, description: locale === "en-US" ? "Generate shot drafts, then adjust visuals, dialogue, and duration." : "按章节生成镜头草稿，再逐镜调整画面、对白和时长。", href: firstUnitId ? `${projectRoot}/chapters/${firstUnitId}` : `${projectRoot}/chapters`, actionLabel: locale === "en-US" ? "Create storyboard" : "建立分镜", tone: "default" });
    }
    if (metrics.shotCount && metrics.readyVideoCount < metrics.shotCount) {
        actions.push({ id: "continue-video", title: locale === "en-US" ? `Produce ${metrics.shotCount - metrics.readyVideoCount} shot videos` : `继续制作 ${metrics.shotCount - metrics.readyVideoCount} 个镜头视频`, description: locale === "en-US" ? "Review prompts and reference assets, then generate and select each shot." : "检查镜头提示词与参考资产，逐镜生成并选择最终版本。", href: workflowHref, actionLabel: locale === "en-US" ? "Continue production" : "继续制作", tone: metrics.staleArtifactCount ? "attention" : "default" });
    }
    if (!metrics.canvasCount) {
        actions.push({ id: "create-canvas", title: locale === "en-US" ? "Create your first project canvas" : "建立第一张项目画布", description: locale === "en-US" ? "Bring chapters, storyboards, and references into one workspace." : "把章节、分镜和参考资产放进同一个制作空间。", href: `${projectRoot}/canvases`, actionLabel: locale === "en-US" ? "View canvases" : "查看画布", tone: "default" });
    }
    if (!actions.length) {
        actions.push({ id: "review-delivery", title: locale === "en-US" ? "Review shots for delivery" : "检查镜头并准备交付", description: locale === "en-US" ? "All shot videos are ready. Check versions, continuity, and missing items." : "所有镜头视频已就绪，可检查版本、连续性和缺失项。", href: workflowHref, actionLabel: locale === "en-US" ? "Review delivery" : "检查交付", tone: "default" });
    }
    return actions;
}

function stageCell(complete: boolean, label: string, attention = false): ProjectStageCell {
    return { label, state: attention ? "attention" : complete ? "completed" : "idle" };
}
