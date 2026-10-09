import { useEffect, useRef, useState } from "react";
import { Button, Spin, Switch } from "antd";
import { ChevronLeft, ChevronRight, ListVideo } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppModal } from "@/components/ui/product/app-modal";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { getTheatreWork, theatreCoverUrl, theatreEpisodeVideoUrl, theatreVideoUrl, type TheatreWork, type TheatreWorkDetail } from "@/services/api/theatre";
import { useUserStore } from "@/stores/use-user-store";
import { readTheatreWatchProgress, saveTheatreWatchProgress, type TheatreWatchProgress } from "./theatre-watch-progress";

export function TheatreWorkPlayer({ work, userId, onClose }: { work: TheatreWork; userId: string; onClose: () => void }) {
    const { text, locale } = useLocaleText();
    const detail = useQuery({ queryKey: ["theatre-detail", userId, work.id], queryFn: ({ signal }) => getTheatreWork(work.id, signal), refetchOnWindowFocus: false });
    return (
        <AppModal
            open
            flush
            title={<span className="block min-w-0 truncate pr-8" title={work.title}>{work.title}</span>}
            width={1080}
            footer={null}
            onCancel={onClose}
        >
            {detail.isPending ? (
                <div role="status" aria-label={text("正在加载作品", "Loading work")} className="flex justify-center p-12">
                    <Spin />
                </div>
            ) : detail.isError ? (
                <div role="alert" className="space-y-4 p-6 text-muted-foreground">
                    <p>{localizedErrorMessage(detail.error, "作品暂时无法观看，可能已经下架", "This work may have been unpublished", locale)}</p>
                    <Button onClick={() => void detail.refetch()}>{text("重新加载", "Retry")}</Button>
                </div>
            ) : (
                <TheatrePlayback key={work.id} detail={detail.data} userId={userId} />
            )}
        </AppModal>
    );
}

function TheatrePlayback({ detail, userId }: { detail: TheatreWorkDetail; userId: string }) {
    const { text } = useLocaleText();
    const { work, episodes } = detail;
    const isDrama = work.kind === "short_drama";
    const [episodeId, setEpisodeId] = useState("");
    const [initializing, setInitializing] = useState(isDrama);
    const [autoNext, setAutoNext] = useState(true);
    const [error, setError] = useState(false);
    const [progressWarning, setProgressWarning] = useState(false);
    const [resumed, setResumed] = useState(false);
    const [ended, setEnded] = useState(false);
    const restoreSeconds = useRef(0);
    const currentId = useRef("");
    const lastSaved = useRef(0);
    const latest = useRef<TheatreWatchProgress | null>(null);
    const mounted = useRef(true);
    const writes = useRef<Promise<void>>(Promise.resolve());
    const selectedIndex = episodes.findIndex((episode) => episode.id === episodeId);
    const selected = episodes[selectedIndex];

    const persist = (progress: TheatreWatchProgress) => {
        if (useUserStore.getState().user?.id !== userId) return;
        latest.current = progress;
        const save = () => saveTheatreWatchProgress(userId, work.id, progress);
        writes.current = writes.current.then(save, save);
        void writes.current.catch(() => {
            if (mounted.current) setProgressWarning(true);
        });
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (!isDrama) return;
        let active = true;
        void readTheatreWatchProgress(userId, work.id)
            .then((progress) => {
                if (!active) return;
                const episode = episodes.find((item) => item.id === progress?.episodeId) || episodes[0];
                currentId.current = episode?.id || "";
                setEpisodeId(currentId.current);
                restoreSeconds.current = progress && episode?.id === progress.episodeId ? progress.seconds : 0;
                setResumed(Boolean(progress && episode?.id === progress.episodeId && (progress.seconds > 0 || episode.number > 1)));
                setInitializing(false);
            })
            .catch(() => {
                if (!active) return;
                currentId.current = episodes[0]?.id || "";
                setEpisodeId(currentId.current);
                setProgressWarning(true);
                setInitializing(false);
            });
        return () => {
            active = false;
            if (latest.current && useUserStore.getState().user?.id === userId) {
                const progress = latest.current;
                const save = () => saveTheatreWatchProgress(userId, work.id, progress);
                void writes.current.then(save, save).catch(() => {});
            }
        };
    }, [userId, work.id, isDrama, episodes]);

    const chooseEpisode = (index: number) => {
        const episode = episodes[index];
        if (!episode || episode.id === currentId.current) return;
        currentId.current = episode.id;
        restoreSeconds.current = 0;
        lastSaved.current = 0;
        setEpisodeId(episode.id);
        setError(false);
        setEnded(false);
        setResumed(false);
        persist({ episodeId: episode.id, seconds: 0 });
    };
    const remember = (video: HTMLVideoElement, force = false) => {
        if (!selected || currentId.current !== selected.id || !Number.isFinite(video.currentTime)) return;
        latest.current = { episodeId: selected.id, seconds: video.currentTime };
        if (!force && Date.now() - lastSaved.current < 5000) return;
        lastSaved.current = Date.now();
        persist(latest.current);
    };
    const unavailable = isDrama && !initializing && !selected;
    return (
        <div className={`hide-scrollbar grid max-h-[88dvh] overflow-y-auto ${isDrama ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
            <div className="min-w-0 p-4 sm:p-5">
                {initializing ? (
                    <div className="flex min-h-80 items-center justify-center" role="status" aria-label={text("正在恢复播放进度", "Restoring playback")}>
                        <Spin />
                    </div>
                ) : unavailable ? (
                    <p role="alert" className="p-8 text-muted-foreground">
                        {text("剧集暂时不可观看，请重新加载作品。", "Episodes are currently unavailable. Reload this work.")}
                    </p>
                ) : (
                    <div className="flex items-center justify-center overflow-hidden rounded-xl bg-secondary">
                        <video
                            key={isDrama ? selected!.id : work.id}
                            src={isDrama ? theatreEpisodeVideoUrl(work.id, selected!.id) : theatreVideoUrl(work.id)}
                            poster={work.coverResourceId ? theatreCoverUrl(work.id, work.updatedAt) : undefined}
                            controls
                            autoPlay
                            playsInline
                            preload="metadata"
                            className={isDrama ? "max-h-[68dvh] min-h-48 w-full object-contain" : "aspect-video w-full object-contain"}
                            aria-label={selected ? `${work.title} · 第 ${selected.number} 集 ${selected.title}` : work.title}
                            onError={() => setError(true)}
                            onPlay={() => setEnded(false)}
                            onTimeUpdate={(event) => remember(event.currentTarget)}
                            onPause={(event) => remember(event.currentTarget, true)}
                            onLoadedMetadata={(event) => {
                                const video = event.currentTarget;
                                if (isDrama && restoreSeconds.current > 0 && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(restoreSeconds.current, Math.max(0, video.duration - 1));
                                restoreSeconds.current = 0;
                            }}
                            onEnded={() => {
                                if (!selected) return;
                                if (autoNext && selectedIndex + 1 < episodes.length) chooseEpisode(selectedIndex + 1);
                                else {
                                    setEnded(true);
                                    persist({ episodeId: selected.id, seconds: 0 });
                                }
                            }}
                        />
                    </div>
                )}
                {error && (
                    <p role="alert" className="mt-3 text-[var(--fs-body)] text-destructive">
                        {text("视频暂时无法播放，作品可能已下架，或当前浏览器不支持该视频编码。", "The video could not play. It may have been unpublished, or its codec may be unsupported.")}
                    </p>
                )}
                {isDrama && selected && (
                    <>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-[var(--fs-body)] font-medium">
                                {text(`第 ${selected.number} 集`, `Episode ${selected.number}`)} · {selected.title}
                            </h2>
                            <div className="flex gap-2">
                                <Button disabled={selectedIndex <= 0} icon={<ChevronLeft className="size-4" />} onClick={() => chooseEpisode(selectedIndex - 1)}>
                                    {text("上一集", "Previous")}
                                </Button>
                                <Button disabled={selectedIndex + 1 >= episodes.length} onClick={() => chooseEpisode(selectedIndex + 1)}>
                                    {text("下一集", "Next")}
                                    <ChevronRight className="size-4" />
                                </Button>
                            </div>
                        </div>
                        {resumed && <p className="mt-2 text-[var(--fs-caption)] text-muted-foreground">{text("已从本机上次观看处继续", "Resumed from your last watch on this device")}</p>}
                        {ended && (
                            <p className="mt-3 text-[var(--fs-body)] text-muted-foreground">
                                {selectedIndex + 1 === episodes.length
                                    ? work.isComplete
                                        ? text("已看完这部短剧", "You have finished this series")
                                        : text("已看完当前集数，等待创作者更新", "You are up to date. More episodes may arrive.")
                                    : text("本集已结束，点击下一集继续观看", "This episode has ended. Select the next episode to continue.")}
                            </p>
                        )}
                        {progressWarning && (
                            <p role="status" className="mt-2 text-[var(--fs-caption)] text-muted-foreground">
                                {text("本机播放进度暂时无法保存，下次打开可能从头开始。", "Progress could not be saved on this device. Playback may restart next time.")}
                            </p>
                        )}
                    </>
                )}
                <p className="mt-4 whitespace-pre-wrap text-[var(--fs-body)] text-muted-foreground">{work.description}</p>
                <p className="mt-3 text-[var(--fs-caption)] text-muted-foreground">{work.authorName}</p>
            </div>
            {isDrama && (
                <aside className="border-t border-border p-4 lg:border-l lg:border-t-0 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="flex items-center gap-2 text-[var(--fs-body)] font-semibold">
                            <ListVideo className="size-4" aria-hidden />
                            {text("选集", "Episodes")}
                        </h2>
                        <span className="text-[var(--fs-caption)] text-muted-foreground">
                            {work.isComplete ? text(`全 ${episodes.length} 集`, `${episodes.length} episodes · Complete`) : text(`更新至 ${episodes.length} 集`, `${episodes.length} episodes · Ongoing`)}
                        </span>
                    </div>
                    <label className="my-4 flex items-center justify-between gap-3 text-[var(--fs-body)] text-muted-foreground">
                        {text("自动播放下一集", "Play next episode automatically")}
                        <Switch checked={autoNext} onChange={setAutoNext} aria-label={text("自动播放下一集", "Play next episode automatically")} />
                    </label>
                    <div className="hide-scrollbar grid grid-cols-5 gap-2 lg:max-h-[56dvh] lg:overflow-y-auto">
                        {episodes.map((episode, index) => (
                            <button
                                key={episode.id}
                                type="button"
                                title={episode.title}
                                aria-label={text(`播放第 ${episode.number} 集：${episode.title}`, `Play episode ${episode.number}: ${episode.title}`)}
                                aria-pressed={episode.id === episodeId}
                                className={`h-10 rounded-lg border text-[var(--fs-body)] focus-visible:outline-2 focus-visible:outline-ring ${episode.id === episodeId ? "border-ring bg-secondary font-semibold text-foreground" : "border-border bg-surface text-muted-foreground hover:bg-surface-hover"}`}
                                onClick={() => chooseEpisode(index)}
                            >
                                {episode.number}
                            </button>
                        ))}
                    </div>
                </aside>
            )}
        </div>
    );
}
