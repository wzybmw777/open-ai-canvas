import { useEffect, useRef, useState } from "react";
import { App, Button, Form, Input, Progress, Spin, Switch } from "antd";
import { Film, ImagePlus, UploadCloud } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AppModal } from "@/components/ui/product/app-modal";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { createTheatreWork, getTheatreWork, theatreCoverUrl, theatreVideoUrl, updateTheatreWork, type TheatreEpisode, type TheatreWork, type TheatreWorkKind, type TheatreWorkMetadata } from "@/services/api/theatre";
import { resourceFileUrl, uploadResourceFile, type RemoteResource } from "@/services/api/resources";
import { probeMediaDurationMs } from "@/lib/media-metadata";
import { useUserStore } from "@/stores/use-user-store";
import { episodeDraftsFromWorks, isTheatreVideoFile } from "./theatre-episode-drafts";
import { TheatreEpisodeEditor } from "./theatre-episode-editor";

type EditorProps = { work: TheatreWork | null; userId: string; initialKind?: TheatreWorkKind; onClose: () => void; onSaved: () => void };

export function TheatreWorkEditor(props: EditorProps) {
    const { text, locale } = useLocaleText();
    const needsEpisodes = props.work?.kind === "short_drama";
    const detail = useQuery({ queryKey: ["theatre-edit", props.userId, props.work?.id], queryFn: ({ signal }) => getTheatreWork(props.work!.id, signal), enabled: needsEpisodes, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
    if (needsEpisodes && (detail.isPending || detail.isFetching || !detail.data))
        return (
            <AppModal open title={text("编辑短剧", "Edit short drama")} footer={null} onCancel={props.onClose}>
                {detail.isError ? (
                    <div role="alert" className="space-y-3 text-muted-foreground">
                        <p>{localizedErrorMessage(detail.error, "剧集加载失败，请重试", "Could not load episodes. Please retry.", locale)}</p>
                        <Button onClick={() => void detail.refetch()}>{text("重试", "Retry")}</Button>
                    </div>
                ) : (
                    <div className="flex justify-center p-8" role="status" aria-label={text("正在加载剧集", "Loading episodes")}>
                        <Spin />
                    </div>
                )}
            </AppModal>
        );
    return <TheatreWorkEditorForm {...props} work={needsEpisodes ? detail.data!.work : props.work} initialEpisodes={needsEpisodes ? detail.data!.episodes : []} />;
}

function TheatreWorkEditorForm({ work, userId, initialKind = "video", initialEpisodes, onClose, onSaved }: EditorProps & { initialEpisodes: TheatreEpisode[] }) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const [form] = Form.useForm<TheatreWorkMetadata>();
    const [kind, setKind] = useState<TheatreWorkKind>(work?.kind || initialKind);
    const [episodes, setEpisodes] = useState(() => episodeDraftsFromWorks(initialEpisodes));
    const [episodesChanged, setEpisodesChanged] = useState(false);
    const [isComplete, setIsComplete] = useState(work?.isComplete || false);
    const [episodeUploading, setEpisodeUploading] = useState(0);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState("");
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [coverPreview, setCoverPreview] = useState("");
    const [coverRemoved, setCoverRemoved] = useState(false);
    const [coverReady, setCoverReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [phase, setPhase] = useState<"video" | "cover" | "publish">("video");
    const uploaded = useRef<RemoteResource | null>(null);
    const uploadedCover = useRef<RemoteResource | null>(null);
    const uploadedEpisodes = useRef(new Map<string, RemoteResource>());
    const idempotencyKey = useRef(crypto.randomUUID());
    const coverIdempotencyKey = useRef(crypto.randomUUID());
    const input = useRef<HTMLInputElement>(null);
    const coverInput = useRef<HTMLInputElement>(null);
    const running = useRef(false);
    const mounted = useRef(true);
    const metadata = useRef<{ width?: number; height?: number; durationMs?: number }>({});
    const coverMetadata = useRef<{ width?: number; height?: number }>({});
    const coverUrl = coverFile ? coverPreview : !coverRemoved && work?.coverResourceId ? theatreCoverUrl(work.id, work.updatedAt) : "";
    const previewFile = kind === "short_drama" ? episodes[0]?.file : file;
    const previewUrl = previewFile ? preview : kind === "short_drama" && episodes[0]?.resourceId ? resourceFileUrl(episodes[0].resourceId) : work ? theatreVideoUrl(work.id) : "";

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        setPreview("");
        if (!previewFile) return;
        const url = URL.createObjectURL(previewFile);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [previewFile]);
    useEffect(() => {
        if (!coverFile) return;
        const url = URL.createObjectURL(coverFile);
        setCoverPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [coverFile]);
    useEffect(() => {
        if (!busy) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [busy]);

    const chooseFile = (selected?: File) => {
        if (!selected || running.current) return;
        if (!isTheatreVideoFile(selected)) {
            message.warning(text("请选择非空的视频文件", "Choose a non-empty video file"));
            return;
        }
        uploaded.current = null;
        metadata.current = {};
        idempotencyKey.current = crypto.randomUUID();
        setFile(selected);
        setProgress(null);
        if (!form.getFieldValue("title")) form.setFieldValue("title", selected.name.replace(/\.[^.]+$/, "").slice(0, 120));
    };

    const chooseCover = (selected?: File) => {
        if (!selected || running.current) return;
        if (selected.size === 0 || selected.size > 10 * 1024 * 1024 || !(["image/jpeg", "image/png", "image/webp"].includes(selected.type) || (!selected.type && /\.(jpe?g|png|webp)$/i.test(selected.name)))) {
            message.warning(text("请选择不超过 10MB 的 JPG、PNG 或 WebP 图片", "Choose a JPG, PNG or WebP image up to 10MB"));
            return;
        }
        uploadedCover.current = null;
        coverMetadata.current = {};
        coverIdempotencyKey.current = crypto.randomUUID();
        setCoverPreview("");
        setCoverReady(false);
        setCoverRemoved(false);
        setCoverFile(selected);
    };

    const save = async (values: TheatreWorkMetadata) => {
        if (running.current) return;
        if (!work && kind === "video" && !file) {
            message.warning(text("请先选择视频", "Choose a video first"));
            return;
        }
        if (kind === "short_drama" && episodes.length === 0) {
            message.warning(text("请先添加短剧视频", "Add episode videos first"));
            return;
        }
        if (coverFile && !coverReady) {
            message.warning(text("请等待封面图片加载完成", "Wait for the cover image to load"));
            return;
        }
        if (useUserStore.getState().user?.id !== userId) return;
        running.current = true;
        setBusy(true);
        try {
            const details: TheatreWorkMetadata = { ...values, kind };
            if (kind === "short_drama") {
                details.isComplete = isComplete;
                if (work) details.expectedUpdatedAt = work.updatedAt;
                if (!work || episodesChanged) {
                    details.episodes = [];
                    for (const [index, episode] of episodes.entries()) {
                        if (!mounted.current || useUserStore.getState().user?.id !== userId) return;
                        let resourceId = episode.resourceId;
                        if (episode.file) {
                            let resource = uploadedEpisodes.current.get(episode.key);
                            if (!resource) {
                                setPhase("video");
                                setEpisodeUploading(index + 1);
                                setProgress(0);
                                const durationMs = await probeMediaDurationMs(episode.file);
                                if (!mounted.current || useUserStore.getState().user?.id !== userId) return;
                                resource = await uploadResourceFile(episode.file, "video", { fileName: episode.file.name, durationMs, idempotencyKey: episode.key }, (loaded, total) => {
                                    if (mounted.current) setProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0);
                                });
                                uploadedEpisodes.current.set(episode.key, resource);
                            }
                            resourceId = resource.id;
                        }
                        if (!resourceId) throw new Error(text("剧集视频尚未上传完成", "An episode video has not finished uploading"));
                        details.episodes.push({ resourceId, title: episode.title });
                    }
                }
            } else if (!work) {
                if (!uploaded.current) {
                    setPhase("video");
                    setProgress(0);
                    uploaded.current = await uploadResourceFile(file!, "video", { ...metadata.current, fileName: file!.name, idempotencyKey: idempotencyKey.current }, (loaded, total) => {
                        if (mounted.current) setProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0);
                    });
                }
            }
            if (!mounted.current || useUserStore.getState().user?.id !== userId) return;
            if (coverFile) {
                if (!uploadedCover.current) {
                    setPhase("cover");
                    setProgress(0);
                    uploadedCover.current = await uploadResourceFile(coverFile, "image", { ...coverMetadata.current, fileName: coverFile.name, idempotencyKey: coverIdempotencyKey.current }, (loaded, total) => {
                        if (mounted.current) setProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0);
                    });
                }
                details.coverResourceId = uploadedCover.current.id;
            } else if (coverRemoved) {
                details.coverResourceId = "";
            }
            if (!mounted.current || useUserStore.getState().user?.id !== userId) return;
            setPhase("publish");
            setProgress(100);
            if (work) await updateTheatreWork(work.id, details);
            else await createTheatreWork(kind === "short_drama" ? details : { ...details, resourceId: uploaded.current!.id });
            if (!mounted.current || useUserStore.getState().user?.id !== userId) return;
            message.success(work ? text("作品信息已保存", "Work updated") : text("作品已发布到卓越剧场", "Published to Excellence Theatre"));
            onSaved();
        } catch (error) {
            if (mounted.current && useUserStore.getState().user?.id === userId) message.error(localizedErrorMessage(error, "作品保存失败，请重试", "Could not save the work. Please retry.", locale));
        } finally {
            running.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    return (
        <AppModal
            open
            centered
            title={work ? text("编辑作品", "Edit work") : kind === "short_drama" ? text("上传短剧", "Upload short drama") : text("上传作品", "Upload work")}
            onCancel={() => {
                if (!running.current) onClose();
            }}
            footer={null}
            width={640}
            closable={!busy}
            keyboard={!busy}
            maskClosable={!busy}
        >
            <Form className="max-h-[75dvh] overflow-y-auto px-1" form={form} layout="vertical" initialValues={{ title: work?.title || "", description: work?.description || "" }} onFinish={(values) => void save(values)}>
                <p className="mb-5 text-[var(--fs-body)] text-muted-foreground">
                    {text("发布后，所有登录用户都能观看。你可以随时编辑作品信息或将作品下架。", "All signed-in users can watch published works. You can edit or unpublish your work at any time.")}
                </p>
                {!work && (
                    <div className="mb-4 flex gap-2" role="group" aria-label={text("作品类型", "Work type")}>
                        {(
                            [
                                { value: "video", label: text("单视频作品", "Single video") },
                                { value: "short_drama", label: text("多集短剧", "Short drama series") },
                            ] as const
                        ).map((item) => (
                            <Button key={item.value} disabled={busy} aria-pressed={kind === item.value} className={kind === item.value ? "bg-secondary font-medium" : ""} onClick={() => setKind(item.value)}>
                                {item.label}
                            </Button>
                        ))}
                    </div>
                )}
                {kind === "short_drama" && (
                    <TheatreEpisodeEditor
                        episodes={episodes}
                        disabled={busy}
                        onChange={(next) => {
                            if (running.current) return;
                            setEpisodes(next);
                            setEpisodesChanged(true);
                        }}
                    />
                )}
                {!work && kind === "video" && (
                    <>
                        <button
                            type="button"
                            className="mb-4 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface p-6 text-muted-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                            disabled={busy}
                            onClick={() => input.current?.click()}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                                event.preventDefault();
                                chooseFile(event.dataTransfer.files[0]);
                            }}
                        >
                            <UploadCloud className="size-7" aria-hidden />
                            <strong className="text-[var(--fs-body)] text-foreground">{file ? file.name : text("点击选择或拖入剪辑好的视频", "Choose or drop your edited video")}</strong>
                            <span className="text-[var(--fs-caption)]">{text("支持 MP4、MOV、WebM 等视频，上传占用账号存储空间", "MP4, MOV, WebM and other videos use your account storage")}</span>
                        </button>
                        <input
                            ref={input}
                            hidden
                            type="file"
                            accept="video/*,.mp4,.mov,.webm,.m4v,.mkv,.avi"
                            disabled={busy}
                            onChange={(event) => {
                                chooseFile(event.target.files?.[0]);
                                event.currentTarget.value = "";
                            }}
                        />
                    </>
                )}
                {previewUrl && (
                    <div className="mb-4 overflow-hidden rounded-xl bg-secondary">
                        <video
                            key={previewUrl}
                            src={previewUrl}
                            poster={coverUrl || undefined}
                            controls
                            playsInline
                            preload="metadata"
                            className="aspect-video w-full object-contain"
                            aria-label={text("视频预览", "Video preview")}
                            onLoadedMetadata={(event) => {
                                const video = event.currentTarget;
                                metadata.current = { width: video.videoWidth, height: video.videoHeight, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined };
                            }}
                        />
                    </div>
                )}
                <div className="mb-5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-[var(--fs-body)] text-foreground">{text("作品封面（选填）", "Cover image (optional)")}</span>
                        <div className="flex gap-2">
                            <Button size="small" disabled={busy} icon={<ImagePlus className="size-4" />} onClick={() => coverInput.current?.click()}>
                                {coverUrl ? text("更换封面", "Replace cover") : text("添加封面", "Add cover")}
                            </Button>
                            {(coverFile || coverUrl) && (
                                <Button
                                    size="small"
                                    disabled={busy}
                                    onClick={() => {
                                        if (running.current) return;
                                        setCoverFile(null);
                                        setCoverPreview("");
                                        setCoverRemoved(true);
                                        uploadedCover.current = null;
                                    }}
                                >
                                    {text("移除", "Remove")}
                                </Button>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        className={`flex ${kind === "short_drama" ? "aspect-[2/3] max-w-56" : "aspect-video"} w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50`}
                        disabled={busy}
                        aria-label={text("选择作品封面", "Choose a cover image")}
                        onClick={() => coverInput.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault();
                            chooseCover(event.dataTransfer.files[0]);
                        }}
                    >
                        {coverUrl ? (
                            <img
                                key={coverUrl}
                                src={coverUrl}
                                alt={text("封面预览", "Cover preview")}
                                className="size-full object-cover"
                                onLoad={(event) => {
                                    if (!coverFile) return;
                                    coverMetadata.current = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
                                    setCoverReady(true);
                                }}
                                onError={() => {
                                    if (!coverFile) return;
                                    setCoverFile(null);
                                    setCoverPreview("");
                                    message.warning(text("无法读取这张图片，请选择其他封面", "Could not read this image. Choose another cover."));
                                }}
                            />
                        ) : (
                            <div className="flex flex-col items-center gap-2 p-4 text-muted-foreground">
                                <ImagePlus className="size-7" aria-hidden />
                                <span>{text("点击选择或拖入封面图片", "Choose or drop a cover image")}</span>
                            </div>
                        )}
                    </button>
                    <p className="mt-2 text-[var(--fs-caption)] text-muted-foreground">
                        {kind === "short_drama"
                            ? text("支持 JPG、PNG、WebP，最大 10MB；短剧推荐 2:3 竖版封面。", "JPG, PNG or WebP, up to 10MB. A 2:3 portrait cover works well for short dramas.")
                            : text("支持 JPG、PNG、WebP，最大 10MB；建议使用 16:9 横版图片。未设置时显示视频画面。", "JPG, PNG or WebP, up to 10MB. A 16:9 image works best. Without a cover, a video frame is shown.")}
                    </p>
                    <input
                        ref={coverInput}
                        hidden
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                        disabled={busy}
                        onChange={(event) => {
                            chooseCover(event.target.files?.[0]);
                            event.currentTarget.value = "";
                        }}
                    />
                </div>
                <Form.Item name="title" label={kind === "short_drama" ? text("短剧名称", "Series title") : text("作品标题", "Title")} rules={[{ required: true, whitespace: true, message: text("请输入作品标题", "Enter a title") }, { max: 120 }]}>
                    <Input maxLength={120} showCount disabled={busy} placeholder={kind === "short_drama" ? text("输入这部短剧的剧名", "Name your short drama series") : text("给你的作品起个名字", "Name your work")} />
                </Form.Item>
                <Form.Item name="description" label={text("作品简介", "Description")} rules={[{ max: 2000 }]}>
                    <Input.TextArea rows={3} maxLength={2000} showCount disabled={busy} placeholder={text("介绍故事、创作想法或剪辑亮点", "Introduce the story or your editing ideas")} />
                </Form.Item>
                {kind === "short_drama" && (
                    <div className="mb-5 flex items-center justify-between gap-4 rounded-lg bg-secondary p-3">
                        <div className="text-[var(--fs-body)]">
                            <p>{text("短剧已完结", "Series complete")}</p>
                            <p className="mt-1 text-[var(--fs-caption)] text-muted-foreground">{text("未开启时显示更新中，可随时继续添加集数", "Leave off while releasing new episodes. You can add more at any time.")}</p>
                        </div>
                        <Switch checked={isComplete} disabled={busy} aria-label={text("短剧已完结", "Series complete")} onChange={setIsComplete} />
                    </div>
                )}
                {busy && (
                    <div role="status" aria-live="polite" className="mb-4">
                        <Progress percent={progress ?? 0} status="active" />
                        <p className="text-[var(--fs-caption)] text-muted-foreground">
                            {phase === "publish"
                                ? text("正在保存作品…", "Saving your work…")
                                : phase === "cover"
                                  ? text("正在上传封面，请保持页面打开…", "Uploading cover. Keep this page open…")
                                  : kind === "short_drama"
                                    ? text(`正在上传第 ${episodeUploading} / ${episodes.length} 集，请保持页面打开…`, `Uploading episode ${episodeUploading} / ${episodes.length}. Keep this page open…`)
                                    : text("正在上传视频，请保持页面打开…", "Uploading video. Keep this page open…")}
                        </p>
                    </div>
                )}
                <div className="flex justify-end gap-2">
                    <Button disabled={busy} onClick={onClose}>
                        {text("取消", "Cancel")}
                    </Button>
                    <Button type="primary" htmlType="submit" loading={busy} disabled={(kind === "short_drama" ? episodes.length === 0 : !work && !file) || Boolean(coverFile && !coverReady)} icon={<Film className="size-4" />}>
                        {work ? text("保存修改", "Save changes") : text("上传并发布", "Upload and publish")}
                    </Button>
                </div>
            </Form>
        </AppModal>
    );
}
