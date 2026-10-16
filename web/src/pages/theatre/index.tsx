import { useState } from "react";
import { App, Button, Input, Pagination, Popconfirm, Spin } from "antd";
import { ArrowUpRight, Clapperboard, Film, Pencil, Play, Plus, Search, Trash2, UploadCloud, Users } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/ui/product/empty-state";
import { PageHeader } from "@/components/layout/workspace-page";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { deleteTheatreWork, listTheatreWorks, theatreCoverUrl, theatreVideoUrl, type TheatreWork, type TheatreWorkKind } from "@/services/api/theatre";
import { useUserStore } from "@/stores/use-user-store";
import { TheatreWorkEditor } from "./theatre-work-editor";
import { TheatreWorkPlayer } from "./theatre-work-player";

export default function TheatrePage() {
    const userId = useUserStore((state) => state.user?.id);
    return userId ? <TheatreWorkspace key={userId} userId={userId} /> : null;
}

function TheatreWorkspace({ userId }: { userId: string }) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [mine, setMine] = useState(false);
    const [kind, setKind] = useState<TheatreWorkKind | "">("");
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [editor, setEditor] = useState<TheatreWork | "new" | "new_drama" | null>(null);
    const [playing, setPlaying] = useState<TheatreWork | null>(null);
    const [removing, setRemoving] = useState<string | null>(null);
    const worksQuery = useQuery({ queryKey: ["theatre", userId, mine, kind, keyword, page], queryFn: ({ signal }) => listTheatreWorks({ mine, kind, q: keyword, page, pageSize: 12 }, signal) });
    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ["theatre", userId] });
    };
    const works = worksQuery.data?.works || [];
    const totalWorks = worksQuery.data?.total || 0;

    const unpublish = async (work: TheatreWork) => {
        if (removing || useUserStore.getState().user?.id !== userId) return;
        setRemoving(work.id);
        try {
            await deleteTheatreWork(work.id);
            if (useUserStore.getState().user?.id !== userId) return;
            message.success(text("作品已下架", "Work unpublished"));
            if (works.length === 1 && page > 1) setPage(page - 1);
            refresh();
        } catch (error) {
            if (useUserStore.getState().user?.id === userId) message.error(localizedErrorMessage(error, "下架失败", "Could not unpublish the work", locale));
        } finally {
            setRemoving(null);
        }
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[var(--product-content-max)] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
                <PageHeader
                    title={text("作品与发布", "Works & publishing")}
                    description={text("管理已发布作品，或上传成片发布为短片、短剧系列。", "Manage published works, or upload a film to publish a video or series.")}
                    meta={worksQuery.isSuccess ? <span className="text-[var(--fs-caption)] text-muted-foreground">{text(`${totalWorks} 部作品`, `${totalWorks} works`)}</span> : undefined}
                    actions={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditor(kind === "short_drama" ? "new_drama" : "new")}>{text("发布作品", "Publish a work")}</Button>}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-xl)] border border-border bg-surface px-3 py-3 sm:px-4">
                    <div className="flex min-w-0 gap-1.5">
                        {[
                            { value: false, label: text("全部作品", "All works") },
                            { value: true, label: text("我的作品", "My works") },
                        ].map((item) => (
                            <Button
                                key={String(item.value)}
                                size="small"
                                aria-pressed={mine === item.value}
                                className={mine === item.value ? "!border-[var(--control-selected-border)] !bg-[var(--control-selected-bg)] !text-[var(--control-selected-fg)] font-medium" : "!border-transparent"}
                                onClick={() => {
                                    setMine(item.value);
                                    setPage(1);
                                }}
                            >
                                {item.label}
                            </Button>
                        ))}
                    </div>
                    <Input.Search
                        prefix={<Search className="size-4 text-muted-foreground" aria-hidden />}
                        className="w-full sm:max-w-xs"
                        allowClear
                        maxLength={120}
                        placeholder={text("搜索作品标题或简介", "Search titles or descriptions")}
                        aria-label={text("搜索剧场作品", "Search theatre works")}
                        onSearch={(value) => {
                            setKeyword(value.trim());
                            setPage(1);
                        }}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={text("筛选作品类型", "Filter work type")}>
                    <span className="mr-1 text-[var(--fs-caption)] font-medium text-muted-foreground">{text("内容类型", "Format")}</span>
                    {(
                        [
                            { value: "", label: text("全部类型", "All types") },
                            { value: "video", label: text("单视频", "Videos") },
                            { value: "short_drama", label: text("短剧", "Short dramas") },
                        ] as const
                    ).map((item) => (
                        <Button
                            key={item.value}
                            aria-pressed={kind === item.value}
                            size="small"
                            className={kind === item.value ? "!border-[var(--control-selected-border)] !bg-[var(--control-selected-bg)] !text-[var(--control-selected-fg)] font-medium" : ""}
                            onClick={() => {
                                setKind(item.value);
                                setPage(1);
                            }}
                        >
                            {item.label}
                        </Button>
                    ))}
                </div>
                {worksQuery.isPending ? (
                    <div className="flex justify-center py-20" role="status" aria-label={text("正在加载作品", "Loading works")}>
                        <Spin />
                    </div>
                ) : worksQuery.isError ? (
                    <EmptyState
                        icon={Film}
                        title={text("作品暂时加载失败", "Could not load works")}
                        description={localizedErrorMessage(worksQuery.error, "请稍后重试", "Please retry", locale)}
                        action={<Button onClick={() => void worksQuery.refetch()}>{text("重新加载", "Retry")}</Button>}
                    />
                ) : works.length === 0 ? (
                    <EmptyState
                        icon={Film}
                        title={keyword ? text("没有找到相关作品", "No matching works") : mine ? text("你还没有发布作品", "No published works yet") : text("暂无公开作品", "No public works yet")}
                        description={keyword ? text("试试其他关键词", "Try another search") : text("上传剪辑好的视频，选择发布为短片或短剧系列。", "Upload an edited video to publish a film or a series.")}
                        action={
                            !keyword ? (
                                <Button icon={<UploadCloud className="size-4" />} onClick={() => setEditor(kind === "short_drama" ? "new_drama" : "new")}>
                                    {text("上传作品", "Upload work")}
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <div className={kind === "short_drama" ? "grid grid-cols-2 items-start gap-4 sm:grid-cols-3 xl:grid-cols-4" : "grid grid-cols-1 items-start gap-5 sm:grid-cols-2 xl:grid-cols-3"}>
                        {works.map((work) => (
                            <article
                                key={work.id}
                                className="group overflow-hidden rounded-[var(--r-xl)] border border-border bg-surface shadow-[0_1px_2px_color-mix(in_srgb,var(--foreground)_4%,transparent)] transition-[transform,box-shadow,border-color] duration-[var(--motion-state)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] hover:shadow-[0_10px_30px_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
                            >
                                <button
                                    type="button"
                                    className={`relative flex ${kind === "short_drama" ? "aspect-[2/3]" : "aspect-video"} w-full items-center justify-center overflow-hidden bg-secondary focus-visible:outline-2 focus-visible:outline-ring`}
                                    aria-label={text(`播放《${work.title}》`, `Play ${work.title}`)}
                                    onClick={() => {
                                        setPlaying(work);
                                    }}
                                >
                                    <TheatreWorkPreview work={work} />
                                    <span className="relative flex size-12 scale-95 items-center justify-center rounded-full bg-surface/90 text-foreground opacity-90 shadow-sm transition duration-[var(--motion-state)] group-hover:scale-100 group-hover:bg-[var(--primary)] group-hover:text-[var(--primary-foreground)]">
                                        <Play className="ml-0.5 size-5" aria-hidden />
                                    </span>
                                    <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                                        {work.kind === "short_drama" ? text("短剧系列", "Series") : text("短片", "Short")}
                                    </span>
                                    {work.kind === "short_drama" && (
                                        <span className="absolute bottom-3 left-3 rounded-lg bg-surface/90 px-2 py-1 text-[var(--fs-caption)] font-medium text-foreground">
                                            {work.isComplete ? text(`全 ${work.episodeCount} 集`, `${work.episodeCount} episodes · Complete`) : text(`更新至 ${work.episodeCount} 集`, `${work.episodeCount} episodes · Ongoing`)}
                                        </span>
                                    )}
                                </button>
                                <div className="p-4">
                                    <h2 className="truncate text-[var(--fs-body)] font-semibold" title={work.title}>
                                        {work.title}
                                    </h2>
                                    <p className="mt-1 line-clamp-2 min-h-10 text-[var(--fs-body)] text-muted-foreground">{work.description || text("创作者还没有填写简介", "No description yet")}</p>
                                    <div className="mt-4 flex items-center justify-between gap-2 text-[var(--fs-caption)] text-muted-foreground">
                                        <span className="flex min-w-0 items-center gap-1.5 truncate">
                                            <Users className="size-3.5 shrink-0" aria-hidden />
                                            {work.authorName}
                                        </span>
                                        <time className="shrink-0" dateTime={work.createdAt}>
                                            {new Date(work.createdAt).toLocaleDateString(locale)}
                                        </time>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[var(--fs-caption)] text-muted-foreground">
                                        <span>{work.kind === "short_drama" ? `${work.episodeCount} ${text("集", "episodes")}` : formatDuration(work.durationMs)}</span>
                                        <span className="inline-flex items-center gap-1 font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                                            {text("立即观看", "Watch now")}
                                            <ArrowUpRight className="size-3.5" aria-hidden />
                                        </span>
                                    </div>
                                    {mine && work.userId === userId && (
                                        <div className="mt-3 flex gap-2 border-t border-border pt-3">
                                            <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditor(work)}>
                                                {text("编辑", "Edit")}
                                            </Button>
                                            <Popconfirm
                                                title={text("下架这部作品？", "Unpublish this work?")}
                                                description={text("下架后，其他用户将无法从作品页观看。", "Other users will no longer be able to watch it on the works page.")}
                                                okText={text("下架", "Unpublish")}
                                                cancelText={text("取消", "Cancel")}
                                                onConfirm={() => unpublish(work)}
                                            >
                                                <Button size="small" danger loading={removing === work.id} disabled={removing !== null} icon={<Trash2 className="size-3.5" />}>
                                                    {text("下架", "Unpublish")}
                                                </Button>
                                            </Popconfirm>
                                        </div>
                                    )}
                                </div>
                            </article>
                        ))}
                    </div>
                )}
                {(worksQuery.data?.total || 0) > 12 && (
                    <div className="flex justify-center">
                        <Pagination current={page} pageSize={12} total={worksQuery.data?.total || 0} showSizeChanger={false} onChange={setPage} />
                    </div>
                )}
            </div>
            {editor && (
                <TheatreWorkEditor
                    work={typeof editor === "string" ? null : editor}
                    initialKind={editor === "new_drama" ? "short_drama" : "video"}
                    userId={userId}
                    onClose={() => setEditor(null)}
                    onSaved={() => {
                        setEditor(null);
                        setPage(1);
                        refresh();
                    }}
                />
            )}
            {playing && <TheatreWorkPlayer work={playing} userId={userId} onClose={() => setPlaying(null)} />}
        </div>
    );
}

function TheatreWorkPreview({ work }: { work: TheatreWork }) {
    const [failedCover, setFailedCover] = useState("");
    const coverUrl = work.coverResourceId ? theatreCoverUrl(work.id, work.updatedAt) : "";
    if (coverUrl && failedCover !== coverUrl) return <img src={coverUrl} alt="" loading="lazy" className={`absolute inset-0 size-full ${work.kind === "short_drama" ? "object-contain" : "object-cover"}`} onError={() => setFailedCover(coverUrl)} />;
    return (
        <video
            src={theatreVideoUrl(work.id)}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
            aria-hidden
            onLoadedMetadata={(event) => {
                if (event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.001, event.currentTarget.duration);
            }}
        />
    );
}

function formatDuration(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return "—";
    const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
