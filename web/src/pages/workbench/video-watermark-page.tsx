import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Spin } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Save, Upload, Video } from "lucide-react";
import { MediaPreview } from "@/components/media-preview";
import { ModelPicker } from "@/components/model-picker";
import { listWorkbenchTasks } from "@/services/api/workbench";
import { cancelGenerationTask, queryGenerationTask, recoverGenerationTaskMedia, retryGenerationTask } from "@/services/api/task-center";
import { downloadBrowserMedia } from "@/services/browser-download";
import { resolveResourceUrl, resourceStorageKey } from "@/services/api/resources";
import { uploadVideoWatermarkSource, readVideoWatermarkSource, readVideoMetadata, submitVideoWatermark, videoWatermarkInput, videoWatermarkResult, videoCleanupStatus, saveVideoWatermarkAsset } from "@/services/api/video-watermark";
import { useEffectiveConfig, logicalModelIDForConfig, resolveModelChannel, selectableModelsByCapability } from "@/stores/use-config-store";
import { modelCapabilityConfigFor, normalizeVideoValue } from "@/lib/model-capabilities";
import { canCancelGenerationTask } from "@/lib/generation-task-display";
import type { ModelRequirements } from "@/lib/model-selection";
import { isVideoCleanupTask } from "@/lib/video-cleanup";
import { useWatermarkTask } from "./use-watermark-task";
import "./video-watermark.css";

export default function VideoWatermarkPanel({ userID }: { userID: string }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const config = useEffectiveConfig();
    const models = useMemo(() => selectableModelsByCapability(config, "video").filter((model) => {
        const profile = modelCapabilityConfigFor(config, model).video;
        return Boolean(profile && profile.operations.includes("video_edit") && profile.references.maxVideos > 0 && (resolveModelChannel(config, model).scope === "system" || logicalModelIDForConfig({ ...config, model })));
    }), [config]);
    const [selectedModel, setSelectedModel] = useState("");
    const [source, setSource] = useState<{ id: string; url: string; width: number; height: number; durationMs: number } | null>(null);
    useEffect(() => { if (!models.includes(selectedModel)) setSelectedModel(models.includes(config.videoModel || "") ? config.videoModel : models[0] || ""); }, [models, selectedModel, config.videoModel]);
    const selectedProfile = selectedModel ? modelCapabilityConfigFor(config, selectedModel).video : undefined;
    const generationConfig = useMemo(() => {
        const normalized = selectedProfile ? normalizeVideoValue(selectedProfile, { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality }) : { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality };
        return { ...config, model: selectedModel, videoModel: selectedModel, videoSeconds: source ? String(Math.ceil(source.durationMs / 1000)) : normalized.seconds, size: normalized.ratio, vquality: normalized.resolution, videoWatermark: "false", videoGenerateAudio: String(selectedProfile?.generateAudio.default ?? false), count: "1" };
    }, [config, selectedModel, selectedProfile, source]);
    const requirements = useMemo<ModelRequirements>(() => ({ capability: "video", videoOperation: "video_edit", videoSeconds: generationConfig.videoSeconds, input: { textCount: 1, imageCount: 0, videoCount: source ? 1 : 0, audioCount: 0, characterCount: 0 } }), [generationConfig.videoSeconds, source]);
    const { taskID, setTaskID } = useWatermarkTask("video");
    const fileInput = useRef<HTMLInputElement>(null);
    const operation = useRef(false);
    const mounted = useRef(true);
    const [prompt, setPrompt] = useState("去除视频中可见的水印、台标、叠加文字或标识，保持主体动作、镜头运动、背景纹理和视频时长自然连续，不添加新的文字或水印。");
    const [busy, setBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [savedTask, setSavedTask] = useState("");
    const [sourceLoading, setSourceLoading] = useState(false);
    const [sourceError, setSourceError] = useState("");
    const [sourceRetry, setSourceRetry] = useState(0);
    const status = useQuery({ queryKey: ["video-cleanup-status", userID], queryFn: ({ signal }) => videoCleanupStatus(signal), enabled: Boolean(userID) });
    const task = useQuery({ queryKey: ["video-cleanup-task", userID, taskID], queryFn: async ({ signal }) => {
        const found = await queryGenerationTask(taskID, { signal });
        if (!isVideoCleanupTask(found)) throw new Error("该任务不属于视频去水印，请从处理历史重新选择");
        return found;
    }, enabled: Boolean(userID && taskID), refetchInterval: (query) => query.state.data && ["queued", "running"].includes(query.state.data.status) ? 3000 : false });
    const history = useQuery({ queryKey: ["video-cleanup-history", userID], queryFn: ({ signal }) => listWorkbenchTasks("video", 100, false, signal), enabled: Boolean(userID), refetchInterval: (query) => query.state.data?.some((item) => isVideoCleanupTask(item) && ["queued", "running"].includes(item.status)) ? 5000 : false });
    const input = videoWatermarkInput(task.data);
    const result = videoWatermarkResult(task.data);
    const resultURL = result ? resolveResourceUrl(resourceStorageKey(result.resourceId)) : "";
    const running = Boolean(task.data && ["queued", "running"].includes(task.data.status));

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { if (taskID && typeof input?.prompt === "string") setPrompt(input.prompt); }, [taskID, input?.prompt]);
    useEffect(() => () => { if (source?.url.startsWith("blob:")) URL.revokeObjectURL(source.url); }, [source]);
    useEffect(() => {
        if (!input?.resourceId || source?.id === input.resourceId) { setSourceLoading(false); setSourceError(""); return; }
        let current = true;
        setSourceLoading(true); setSourceError("");
        readVideoWatermarkSource(input.resourceId).then((blob) => readVideoMetadata(blob).then((meta) => {
            if (current) setSource({ id: input.resourceId, url: URL.createObjectURL(blob), ...meta });
        })).catch((failure) => { if (current) setSourceError(failure instanceof Error ? failure.message : "原视频读取失败"); }).finally(() => { if (current) setSourceLoading(false); });
        return () => { current = false; };
    }, [input?.resourceId, source?.id, sourceRetry]);

    const upload = async (file: File) => {
        if (operation.current || running || !status.data?.available) return;
        operation.current = true; setBusy(true); setError("");
        try {
            const uploaded = await uploadVideoWatermarkSource(file);
            if (!mounted.current) return;
            setTaskID(""); setSource({ id: uploaded.resource.id, url: URL.createObjectURL(uploaded.blob), width: uploaded.width, height: uploaded.height, durationMs: uploaded.durationMs }); setSavedTask(""); setSourceLoading(false); setSourceError("");
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "视频上传失败"); }
        finally { operation.current = false; if (mounted.current) setBusy(false); }
    };
    const submit = async () => {
        if (operation.current || !source || !selectedModel || running || !status.data?.available || sourceLoading || Boolean(input && source.id !== input.resourceId)) return;
        operation.current = true; setBusy(true); setError("");
        try {
            const created = await submitVideoWatermark(source.id, generationConfig, prompt);
            if (!mounted.current) return;
            queryClient.setQueryData(["video-cleanup-task", userID, created.id], created);
            setTaskID(created.id); void history.refetch();
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "提交处理失败"); }
        finally { operation.current = false; if (mounted.current) setBusy(false); }
    };
    const save = async () => {
        if (!task.data || !result || saving) return;
        setSaving(true); setError("");
        try {
            await saveVideoWatermarkAsset(task.data);
            if (mounted.current) { setSavedTask(task.data.id); message.success("已保存到服务端素材库"); }
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "素材保存失败"); }
        finally { if (mounted.current) setSaving(false); }
    };
    const taskAction = async (action: "cancel" | "retry" | "recover") => {
        if (operation.current) return;
        operation.current = true; setBusy(true); setError("");
        try {
            const updated = await (action === "cancel" ? cancelGenerationTask(taskID) : action === "recover" ? recoverGenerationTaskMedia(taskID) : retryGenerationTask(taskID));
            if (mounted.current) {
                queryClient.setQueryData(["video-cleanup-task", userID, updated.id], updated);
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                void task.refetch(); void history.refetch();
            }
        }
        catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "任务操作失败"); }
        finally { operation.current = false; if (mounted.current) setBusy(false); }
    };

    return <div className="video-watermark-page">
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
            <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">上传视频 → 选择视频编辑模型 → 修复并下载</p><Button icon={<Upload className="size-4" />} loading={busy && !source} disabled={running || busy || !status.data?.available} onClick={() => fileInput.current?.click()}>{source ? "更换视频" : "上传视频"}</Button><input ref={fileInput} type="file" accept="video/mp4,video/quicktime" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} /></div>
                {status.isPending ? <p role="status"><Spin size="small" /> 正在检查功能状态…</p> : null}
                {status.error ? <p role="alert" className="text-sm text-destructive">{status.error.message}<Button size="small" onClick={() => void status.refetch()}>重试</Button></p> : null}
                {status.data && !status.data.available ? <p role="alert" className="text-sm text-destructive">{status.data.message || "视频去水印暂不可用"}</p> : null}
                <div className="mb-4"><ModelPicker config={generationConfig} value={selectedModel} onChange={setSelectedModel} capability="video" fullWidth requirements={requirements} showSelectedPrice={Boolean(source)} modelFilter={(model) => models.includes(model)} /><p className="mt-2 text-sm text-muted-foreground">{models.length ? "模型会根据视频编辑能力和文字指令修复水印，可能改变局部细节。" : "暂无支持视频编辑的可用平台模型，请联系管理员配置。"}</p></div>
                <label className="mb-4 block text-sm">处理要求<Input.TextArea rows={3} maxLength={2500} showCount value={prompt} disabled={busy || running} onChange={(event) => setPrompt(event.target.value)} /></label>
                {sourceLoading ? <p role="status"><Spin size="small" /> 正在读取原视频…</p> : sourceError ? <p role="alert" className="text-sm text-destructive">{sourceError}<Button size="small" onClick={() => setSourceRetry((value) => value + 1)}>重试读取</Button></p> : source ? <><p className="mb-2 text-sm text-muted-foreground">原视频 · {(source.durationMs / 1000).toFixed(1)} 秒</p><video key={source.url} src={source.url} controls playsInline className="mx-auto block max-h-[62vh] max-w-full rounded-lg" /></> : <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg bg-surface-active p-6 text-center"><Video className="size-8 text-muted-foreground" /><p>上传视频开始去水印</p><p className="text-sm text-muted-foreground">MP4 / MOV · 3–15 秒 · 最大 100MB</p></div>}
                {running ? <div role="status" className="mt-4 flex items-center gap-3 text-sm"><Spin size="small" /><span>{task.data?.stage || "正在处理"}</span>{task.data && canCancelGenerationTask(task.data) ? <Button size="small" disabled={busy} onClick={() => void taskAction("cancel")}>取消处理</Button> : null}</div> : null}
                {task.data?.status === "failed" || task.data?.status === "cancelled" ? <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-destructive"><span>{task.data.error || "处理已取消"}</span><Button disabled={busy} onClick={() => void taskAction(task.data?.canRecoverMedia ? "recover" : "retry")}>{task.data?.canRecoverMedia ? "重试保存" : "重试原任务（按模型计费）"}</Button></div> : null}
                {result ? <div className="mt-5"><p className="mb-2 text-sm text-muted-foreground">修复结果</p><video src={resultURL} controls playsInline className="mx-auto block max-h-[62vh] max-w-full rounded-lg" /><div className="mt-4 flex flex-wrap gap-3"><Button icon={<Download className="size-4" />} onClick={() => { void downloadBrowserMedia({ storageKey: resourceStorageKey(result.resourceId), fileName: "watermark-removed.mp4" }).catch((failure) => setError(failure instanceof Error ? failure.message : "下载失败")); }}>下载结果</Button><Button loading={saving} disabled={savedTask === taskID} icon={<Save className="size-4" />} onClick={() => void save()}>{savedTask === taskID ? "已加入素材库" : "保存到素材库"}</Button><Button disabled={busy} onClick={() => setTaskID("")}>重新处理</Button></div></div> : null}
                {source && !result ? <Button type="primary" className="mt-5" loading={busy} disabled={!selectedModel || !models.includes(selectedModel) || running || sourceLoading || !status.data?.available || (Boolean(taskID) && !task.data) || Boolean(input && source.id !== input.resourceId)} onClick={() => void submit()}>开始去水印</Button> : null}
                {task.error ? <p role="alert" className="mt-4 text-sm text-destructive">{task.error.message}<Button size="small" onClick={() => void task.refetch()}>重新查询</Button></p> : null}
                {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
            </section>
            <aside className="flex flex-col gap-4">
                <section className="rounded-xl border border-border bg-surface p-4"><h2 className="font-medium">处理说明</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">平台视频编辑模型按文字指令进行局部或全局修复，可能改变水印周围纹理、主体细节或镜头内容。处理按所选模型正常计费。</p></section>
                <section className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between gap-2"><h2 className="font-medium">最近处理</h2><Button size="small" loading={history.isFetching} onClick={() => void history.refetch()}>刷新</Button></div>
                    {history.isPending ? <p role="status" className="mt-3 text-sm"><Spin size="small" /> 正在读取历史…</p> : null}
                    {history.error ? <p role="alert" className="mt-3 text-sm text-destructive">{history.error.message}</p> : null}
                    <div className="mt-3 flex flex-col gap-2">{history.data?.filter(isVideoCleanupTask).map((item) => <button type="button" key={item.id} aria-pressed={taskID === item.id} disabled={busy || running || saving} className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-active aria-pressed:bg-surface-active disabled:opacity-50" onClick={() => { setError(""); setTaskID(item.id); }}><span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-active">{item.previewUrl ? <MediaPreview src={item.previewUrl} kind="video" alt="去水印结果" className="size-full object-cover" /> : <Video className="size-4" />}</span><span className="text-sm"><span className="block">视频去水印</span><span className="text-xs text-muted-foreground">{item.status === "succeeded" ? "已完成" : item.status === "failed" ? "处理失败" : item.status === "cancelled" ? "已取消" : item.stage || "处理中"}</span></span></button>)}</div>
                    {history.data && !history.data.some(isVideoCleanupTask) ? <p className="mt-3 text-sm text-muted-foreground">处理结果会保留在这里</p> : null}
                </section>
            </aside>
        </div>
    </div>;
}
