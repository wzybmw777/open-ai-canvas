import { useState } from "react";
import { App, Button, Input, Pagination, Popconfirm, Spin } from "antd";
import { Film, Pencil, Play, Trash2, UploadCloud } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/ui/product/empty-state";
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
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="mb-2 flex items-center gap-2 text-[var(--fs-caption)] font-medium text-muted-foreground">
                            <Film className="size-4" aria-hidden />
                            {text("让创作被看见", "Give your stories an audience")}
                        </div>
                        <h1 className="text-[var(--fs-title)] font-semibold text-foreground">{text("卓越剧场", "Excellence Theatre")}</h1>
                        <p className="mt-2 text-[var(--fs-body)] text-muted-foreground">{text("分享剪辑好的短片或多集短剧，让每个故事被看见。", "Share finished videos or short drama series and give every story an audience.")}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<Film className="size-4" />} onClick={() => setEditor("new_drama")}>
                            {text("上传短剧", "Upload short drama")}
                        </Button>
                        <Button type="primary" icon={<UploadCloud className="size-4" />} onClick={() => setEditor(kind === "short_drama" ? "new_drama" : "new")}>
                            {text("上传作品", "Upload work")}
                        </Button>
                    </div>
                </header>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                        {[
                            { value: false, label: text("全部作品", "All works") },
                            { value: true, label: text("我的作品", "My works") },
                        ].map((item) => (
                            <Button
                                key={String(item.value)}
                                aria-pressed={mine === item.value}
                                className={mine === item.value ? "bg-secondary font-medium" : ""}
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
                <div className="flex gap-2" role="group" aria-label={text("筛选作品类型", "Filter work type")}>
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
                            className={kind === item.value ? "bg-secondary font-medium" : ""}
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
                        title={keyword ? text("没有找到相关作品", "No matching works") : mine ? text("你的作品即将登场", "Your premiere awaits") : text("剧场等待第一部作品", "Be the first to premiere")}
                        description={keyword ? text("试试其他关键词", "Try another search") : text("上传剪辑好的视频，让每一个故事拥有自己的舞台。", "Upload an edited video and give your story a stage.")}
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
                            <article key={work.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                                <button
                                    type="button"
                                    className={`group relative flex ${kind === "short_drama" ? "aspect-[2/3]" : "aspect-video"} w-full items-center justify-center overflow-hidden bg-secondary focus-visible:outline-2 focus-visible:outline-ring`}
                                    aria-label={text(`播放《${work.title}》`, `Play ${work.title}`)}
                                    onClick={() => {
                                        setPlaying(work);
                                    }}
                                >
                                    <TheatreWorkPreview work={work} />
                                    <span className="relative flex size-12 items-center justify-center rounded-full bg-surface/90 text-foreground shadow-sm">
                                        <Play className="size-5" aria-hidden />
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
                                        <span className="truncate">{work.authorName}</span>
                                        <time dateTime={work.createdAt}>{new Date(work.createdAt).toLocaleDateString(locale)}</time>
                                    </div>
                                    {mine && work.userId === userId && (
                                        <div className="mt-3 flex gap-2 border-t border-border pt-3">
                                            <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditor(work)}>
                                                {text("编辑", "Edit")}
                                            </Button>
                                            <Popconfirm
                                                title={text("下架这部作品？", "Unpublish this work?")}
                                                description={text("下架后，其他用户将无法从剧场观看。", "Other users will no longer be able to watch it in the theatre.")}
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
    if (coverUrl && failedCover !== coverUrl) return <img src={coverUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setFailedCover(coverUrl)} />;
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
