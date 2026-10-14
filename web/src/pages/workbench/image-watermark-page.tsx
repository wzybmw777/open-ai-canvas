import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Slider, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Download, Eraser, ImagePlus, Save } from "lucide-react";
import { ImageMaskEditor, type ImageMaskEditorHandle } from "@/components/image-mask-editor";
import { MediaPreview } from "@/components/media-preview";
import { imageCleanupStatus, imageCleanupInput, imageCleanupResult, readImageCleanupSource, saveImageCleanupAsset, submitImageCleanup, uploadImageCleanupSource } from "@/services/api/image-cleanup";
import { queryGenerationTask, retryGenerationTask, cancelGenerationTask, recoverGenerationTaskMedia } from "@/services/api/task-center";
import { listWorkbenchTasks } from "@/services/api/workbench";
import { resolveResourceUrl, resourceStorageKey } from "@/services/api/resources";
import { downloadBrowserMedia } from "@/services/browser-download";
import { ModelPicker } from "@/components/model-picker";
import { useEffectiveConfig, logicalModelIDForConfig, resolveModelChannel, selectableModelsByCapability } from "@/stores/use-config-store";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { canCancelGenerationTask } from "@/lib/generation-task-display";
import { isImageCleanupTask } from "@/lib/image-cleanup";
import { useWatermarkTask } from "./use-watermark-task";
import "./image-watermark.css";

export default function ImageWatermarkPanel({ userID }: { userID: string }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const models = useMemo(() => selectableModelsByCapability(config, "image").filter((model) => {
        const profile = modelCapabilityConfigFor(config, model).image;
        return Boolean(profile && profile.references.maxImages > 0 && (resolveModelChannel(config, model).scope === "system" || logicalModelIDForConfig({ ...config, model })));
    }), [config]);
    const [selectedModel, setSelectedModel] = useState("");
    useEffect(() => { if (!models.includes(selectedModel)) setSelectedModel(models.includes(config.imageModel || "") ? config.imageModel : models[0] || ""); }, [models, selectedModel, config.imageModel]);
    const generationConfig = useMemo(() => ({ ...config, ...defaultImageParamsForModel(config, selectedModel), model: selectedModel, imageModel: selectedModel, count: "1" }), [config, selectedModel]);
    const maskSupported = Boolean(selectedModel && modelCapabilityConfigFor(config, selectedModel).image?.references.maskSupported);
    const { taskID, setTaskID } = useWatermarkTask("image");
    const fileInput = useRef<HTMLInputElement>(null);
    const editor = useRef<ImageMaskEditorHandle>(null);
    const operation = useRef(false);
    const mounted = useRef(true);
    const [source, setSource] = useState<{ id: string; url: string } | null>(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [comparison, setComparison] = useState(50);
    const [editing, setEditing] = useState(true);
    const [savedTask, setSavedTask] = useState("");
    const status = useQuery({ queryKey: ["image-cleanup-status", userID], queryFn: ({ signal }) => imageCleanupStatus(signal), enabled: Boolean(userID) });
    const task = useQuery({ queryKey: ["image-cleanup-task", userID, taskID], queryFn: ({ signal }) => queryGenerationTask(taskID, { signal }), enabled: Boolean(userID && taskID),
        refetchInterval: (query) => query.state.data && ["queued", "running"].includes(query.state.data.status) ? 2000 : false });
    const history = useQuery({ queryKey: ["image-cleanup-history", userID], queryFn: ({ signal }) => listWorkbenchTasks("image", 100, false, signal), enabled: Boolean(userID), refetchInterval: task.data && ["queued", "running"].includes(task.data.status) ? 5000 : false });
    const running = task.data && ["queued", "running"].includes(task.data.status);
    const input = imageCleanupInput(task.data);
    const result = imageCleanupResult(task.data);
    const resultURL = result ? resolveResourceUrl(resourceStorageKey(result.resourceId)) : "";

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => () => { if (source?.url) URL.revokeObjectURL(source.url); }, [source]);
    useEffect(() => {
        if (!input?.resourceId || source?.id === input.resourceId) return;
        let current = true;
        readImageCleanupSource(input.resourceId).then((blob) => {
            if (current) { setSource({ id: input.resourceId, url: URL.createObjectURL(blob) }); setReady(false); }
        }).catch((failure) => { if (current) setError(failure instanceof Error ? failure.message : "原图读取失败"); });
        return () => { current = false; };
    }, [input?.resourceId, source?.id]);
    useEffect(() => {
        if (task.data?.status === "succeeded") { setEditing(false); void history.refetch(); }
    }, [task.data?.status, taskID]);

    const upload = async (file: File) => {
        if (operation.current || running || !status.data?.available) return;
        operation.current = true; setBusy(true); setError("");
        try {
            const { resource, blob } = await uploadImageCleanupSource(file, status.data);
            if (!mounted.current) return;
            setTaskID(""); setSource({ id: resource.id, url: URL.createObjectURL(blob) }); setReady(false); setEditing(true); setSavedTask("");
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "图片上传失败"); }
        finally { operation.current = false; if (mounted.current) setBusy(false); }
    };
    const submit = async () => {
        if (operation.current || !source || !selectedModel || running || (maskSupported && !editor.current)) return;
        operation.current = true; setBusy(true); setError("");
        try {
            const created = await submitImageCleanup(source.id, generationConfig, maskSupported ? editor.current!.exportMask() : undefined);
            if (!mounted.current) return;
            setTaskID(created.id); void history.refetch();
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "提交处理失败"); }
        finally { operation.current = false; if (mounted.current) setBusy(false); }
    };
    const save = async () => {
        if (!task.data || saving) return;
        setSaving(true); setError("");
        try {
            await saveImageCleanupAsset(task.data);
            if (mounted.current) { setSavedTask(taskID); message.success("已保存到服务端素材库"); }
        } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "素材保存失败"); }
        finally { if (mounted.current) setSaving(false); }
    };
    const taskAction = async (action: "cancel" | "retry" | "recover") => {
        if (operation.current) return;
        operation.current = true; setBusy(true); setError("");
        try { await (action === "cancel" ? cancelGenerationTask(taskID) : action === "recover" ? recoverGenerationTaskMedia(taskID) : retryGenerationTask(taskID)); if (mounted.current) { void task.refetch(); void history.refetch(); } }
        catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "任务操作失败"); }
        finally { operation.current = false; if (mounted.current) setBusy(false); }
    };

    return <div className="image-watermark-page">
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
            <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">上传图片 → 选择模型 → 修复并下载</p>
                    <Button icon={<ImagePlus className="size-4" />} loading={busy && !source} disabled={!status.data?.available || Boolean(running) || busy} onClick={() => fileInput.current?.click()}>{source ? "更换图片" : "上传图片"}</Button>
                    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
                </div>
                {status.isPending ? <p role="status" className="text-sm"><Spin size="small" /> 正在检查功能状态…</p> : null}
                {status.error ? <p role="alert" className="text-sm text-destructive">{status.error.message}<Button size="small" onClick={() => void status.refetch()}>重试</Button></p> : null}
                <div className="mb-4"><ModelPicker config={generationConfig} value={selectedModel} onChange={setSelectedModel} capability="image" fullWidth modelFilter={(model) => models.includes(model)} />
                    <p className="mt-2 text-sm text-muted-foreground">{!models.length ? "暂无支持参考图的可用平台模型，请联系管理员配置。" : maskSupported ? "当前模型支持蒙版，请涂抹水印区域后处理。" : "当前模型将自动识别可见水印并修复，可能改变周围内容。"}</p>
                </div>
                {input && source?.id !== input.resourceId ? <p role="status"><Spin size="small" /> 正在读取原图…</p> : source ? editing || !result ? maskSupported ? <ImageMaskEditor key={source.url} ref={editor} dataUrl={source.url} onReady={setReady} disabled={busy || Boolean(running)} /> : <img src={source.url} alt="待去水印原图" className="mx-auto block max-h-[62vh] max-w-full rounded-lg" /> : <>
                    <div className="image-watermark-comparison" aria-label="原图与修复结果对比">
                        <img src={resultURL} alt="去水印结果" draggable={false} />
                        <img src={source.url} alt="原图" draggable={false} className="image-watermark-original" style={{ clipPath: `inset(0 ${100 - comparison}% 0 0)` }} />
                        <span className="image-watermark-divider" style={{ left: `${comparison}%` }} aria-hidden />
                        <span className="image-watermark-label is-original">原图</span><span className="image-watermark-label is-result">修复结果</span>
                    </div>
                    <label className="mt-4 block text-sm">拖动查看修复前后<Slider value={comparison} onChange={setComparison} min={0} max={100} /></label>
                </> : <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg bg-surface-active p-6 text-center">
                    <Eraser className="size-8 text-muted-foreground" /><p>上传一张图片开始去水印</p><p className="text-sm text-muted-foreground">PNG / JPEG / WebP · 最大 10MB · 最长边 4096 像素</p>
                </div>}
                {task.error ? <p role="alert" className="mt-4 text-sm text-destructive">{task.error.message}<Button size="small" onClick={() => void task.refetch()}>重新查询</Button></p> : null}
                {running ? <div role="status" className="mt-4 flex items-center gap-3 text-sm"><Spin size="small" /><span>{task.data?.stage || "正在处理"}，离开页面后可从历史继续查看。</span>{task.data && canCancelGenerationTask(task.data) ? <Button size="small" disabled={busy} onClick={() => void taskAction("cancel")}>取消处理</Button> : null}</div> : null}
                {task.data?.status === "failed" || task.data?.status === "cancelled" ? <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-destructive"><span>{task.data.error || "处理已取消"}</span><Button disabled={!status.data?.available || busy} onClick={() => void taskAction(task.data?.canRecoverMedia ? "recover" : "retry")}>{task.data.canRecoverMedia ? "重试保存" : "重试原任务（按模型计费）"}</Button></div> : null}
                {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                    {source && editing ? <Button type="primary" loading={busy} disabled={(maskSupported && !ready) || !selectedModel || !status.data?.available || Boolean(running)} icon={<Eraser className="size-4" />} onClick={() => void submit()}>开始去水印</Button> : null}
                    {result ? <>
                        <Button icon={<Download className="size-4" />} onClick={() => { void downloadBrowserMedia({ storageKey: resourceStorageKey(result.resourceId), fileName: "watermark-removed.png" }).catch((failure) => setError(failure instanceof Error ? failure.message : "下载失败")); }}>下载结果</Button>
                        <Button loading={saving} disabled={savedTask === taskID} icon={<Save className="size-4" />} onClick={() => void save()}>{savedTask === taskID ? "已加入素材库" : "保存到素材库"}</Button>
                        <Button onClick={() => { setEditing(!editing); setError(""); }}>{editing ? "查看结果对比" : "重新处理"}</Button>
                    </> : null}
                </div>
            </section>
            <aside className="flex min-w-0 flex-col gap-4">
                <section className="rounded-xl border border-border bg-surface p-4"><h2 className="font-medium">处理说明</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">支持蒙版时完整涂抹水印及边缘。模型可能调整细节、构图或输出尺寸，请对比原图检查结果。</p><p className="mt-3 text-sm leading-6 text-muted-foreground">原图始终保留。处理按所选平台模型正常计费，沿用现有积分与任务规则。</p></section>
                <section className="rounded-xl border border-border bg-surface p-4"><div className="flex items-center justify-between"><h2 className="font-medium">最近处理</h2><Button size="small" onClick={() => void history.refetch()}>刷新</Button></div>
                    {history.isPending ? <Spin size="small" /> : null}
                    {history.error ? <p role="alert" className="mt-3 text-sm text-destructive">历史读取失败，请刷新重试。</p> : null}
                    <div className="mt-3 flex flex-col gap-2">{history.data?.filter(isImageCleanupTask).map((item) => <button type="button" key={item.id} className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-active disabled:opacity-50" disabled={Boolean(running) || busy} aria-pressed={taskID === item.id} onClick={() => { setTaskID(item.id); setEditing(true); setError(""); }}>
                        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-active">{item.previewUrl ? <MediaPreview src={item.previewUrl} kind="image" alt="处理结果" className="size-full object-cover" /> : <Eraser className="size-4" />}</span>
                        <span className="min-w-0 text-sm"><span className="block truncate">图片去水印</span><span className="block text-xs text-muted-foreground">{item.status === "succeeded" ? "已完成" : item.status === "failed" ? "处理失败" : item.status === "cancelled" ? "已取消" : item.stage || "排队中"}</span></span>
                    </button>)}</div>
                    {history.data && !history.data.some(isImageCleanupTask) ? <p className="mt-3 text-sm text-muted-foreground">处理结果会保留在这里</p> : null}
                </section>
            </aside>
        </div>
    </div>;
}
