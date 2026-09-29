import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Modal } from "antd";
import { Select } from "@/components/ui/base/select";
import { Archive, Check, Eye, FolderOpen, Image as ImageIcon, Palette, Pencil, Save, ShieldAlert, Trash2 } from "lucide-react";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CanvasStyleDetailModal, CanvasStylePickerModal, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { createStyleProfileSnapshot, parseStyleProfile, resolveStyleExecutionPlan, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { localizedErrorMessage, useLocaleText, type AppLocale } from "@/lib/i18n";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { listProjectAssetsPage, updateProject } from "@/services/api/projects";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelDisplayName, resolveModelRequestConfig, useEffectiveConfig } from "@/stores/use-config-store";

import type { ProjectDetailViewProps } from "./shared";

export default function ProjectSettingsView({ detail, refreshProject }: ProjectDetailViewProps) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const { project } = detail;
    const personalAssets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [name, setName] = useState(project.name);
    const [description, setDescription] = useState(project.description || "");
    const [aspectRatio, setAspectRatio] = useState(project.aspectRatio);
    const [sourceType, setSourceType] = useState(project.sourceType);
    const [stylePresetId, setStylePresetId] = useState(project.stylePresetId || "");
    const [styleProfileJson, setStyleProfileJson] = useState(project.styleProfileJson || "");
    const [defaultImageModel, setDefaultImageModel] = useState(project.defaultImageModel || "");
    const [defaultVideoModel, setDefaultVideoModel] = useState(project.defaultVideoModel || "");
    const [styleDetail, setStyleDetail] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [styleEditorRequested, setStyleEditorRequested] = useState(false);
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [coverPickerOpen, setCoverPickerOpen] = useState(false);
    const [coverPage, setCoverPage] = useState(1);
    const [coverPageSize, setCoverPageSize] = useState(40);
    const coverAssetsQuery = useQuery({
        queryKey: ["project", project.id, "assets", "cover-picker", coverPage, coverPageSize],
        queryFn: () => listProjectAssetsPage(project.id, { page: coverPage, pageSize: coverPageSize, mediaType: "image" }),
        enabled: coverPickerOpen,
    });
    const projectCoverAssets = coverAssetsQuery.data?.assets || [];
    useEffect(() => { setName(project.name); setDescription(project.description || ""); setAspectRatio(project.aspectRatio); setSourceType(project.sourceType); setStylePresetId(project.stylePresetId || ""); setStyleProfileJson(project.styleProfileJson || ""); setDefaultImageModel(project.defaultImageModel || ""); setDefaultVideoModel(project.defaultVideoModel || ""); }, [project]);
    const dirty = useMemo(() => name.trim() !== project.name || description !== (project.description || "") || aspectRatio !== project.aspectRatio || sourceType !== project.sourceType || stylePresetId !== (project.stylePresetId || "") || styleProfileJson !== (project.styleProfileJson || "") || defaultImageModel !== (project.defaultImageModel || "") || defaultVideoModel !== (project.defaultVideoModel || ""), [aspectRatio, defaultImageModel, defaultVideoModel, description, name, project, sourceType, stylePresetId, styleProfileJson]);
    const selectedStyle = useMemo(() => resolveProjectCanvasStyle(stylePresetId, styleProfileJson), [stylePresetId, styleProfileJson]);
    const styleProfile = useMemo(() => parseStyleProfile(styleProfileJson) || selectedStyle?.profile || (selectedStyle ? createStyleProfileSnapshot(selectedStyle) : null), [selectedStyle, styleProfileJson]);
    const enabledStyleAssets = styleProfile?.assets.filter((asset) => asset.enabled !== false) || [];
    const styleExecutionPlans = useMemo(() => {
        if (!styleProfile) return null;
        const imageConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.imageModel || effectiveConfig.model);
        const videoConfig = resolveModelRequestConfig(effectiveConfig, effectiveConfig.videoModel || effectiveConfig.model);
        return {
            image: resolveStyleExecutionPlan(styleProfile, { mode: "image", model: imageConfig.model, interfaceType: imageConfig.interfaceType || imageConfig.apiFormat }),
            video: resolveStyleExecutionPlan(styleProfile, { mode: "video", model: videoConfig.model, interfaceType: videoConfig.interfaceType || videoConfig.apiFormat }),
        };
    }, [effectiveConfig, styleProfile]);
    const coverPickerItems = useMemo<AssetLibraryPickerItem[]>(() => {
        const result: AssetLibraryPickerItem[] = [];
        const seenResourceIds = new Set<string>();
        for (const asset of personalAssets) {
            if (asset.kind !== "image") continue;
            const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
            if (!resourceId || seenResourceIds.has(resourceId)) continue;
            seenResourceIds.add(resourceId);
            result.push({ id: asset.id, title: asset.title, category: "image", kindLabel: text("图片", "Image"), asset, description: asset.note || text("个人素材库", "Personal asset library"), searchText: (asset.tags || []).join(" ") });
        }
        for (const asset of projectCoverAssets) {
            if (asset.mediaType !== "image") continue;
            const resourceId = resourceIdFromStorageKey(asset.storageKey);
            if (!resourceId || seenResourceIds.has(resourceId)) continue;
            seenResourceIds.add(resourceId);
            result.push({ id: `project:${asset.id}`, title: asset.title, category: "image", kindLabel: text("项目图片", "Project image"), imageUrl: resourceFileUrl(resourceId), description: text("项目素材库", "Project assets"), searchText: asset.title });
        }
        if (project.coverResourceId && !seenResourceIds.has(project.coverResourceId)) {
            result.unshift({ id: `current:${project.coverResourceId}`, title: text("当前项目主图", "Current project cover"), category: "image", kindLabel: text("当前主图", "Current cover"), imageUrl: resourceFileUrl(project.coverResourceId) });
        }
        return result;
    }, [personalAssets, project.coverResourceId, projectCoverAssets, locale]);
    const coverResourceByItemId = useMemo(() => new Map(coverPickerItems.flatMap((item) => {
        if (item.id.startsWith("current:")) return [[item.id, item.id.slice("current:".length)] as const];
        if (item.id.startsWith("project:")) {
            const asset = projectCoverAssets.find((entry) => `project:${entry.id}` === item.id);
            const resourceId = resourceIdFromStorageKey(asset?.storageKey);
            return resourceId ? [[item.id, resourceId] as const] : [];
        }
        const asset = personalAssets.find((entry) => entry.id === item.id);
        const resourceId = asset?.kind === "image" ? resourceIdFromStorageKey(asset.data.storageKey) : "";
        return resourceId ? [[item.id, resourceId] as const] : [];
    })), [coverPickerItems, personalAssets, projectCoverAssets]);
    const coverResourceByItemIdRef = useRef(new Map<string, string>());
    useEffect(() => {
        for (const [itemId, resourceId] of coverResourceByItemId) coverResourceByItemIdRef.current.set(itemId, resourceId);
    }, [coverResourceByItemId]);
    const currentCoverItemId = coverPickerItems.find((item) => coverResourceByItemId.get(item.id) === project.coverResourceId)?.id;
    const saveMutation = useMutation({ mutationFn: () => updateProject(project.id, { name: name.trim(), description, aspectRatio, sourceType, stylePresetId, styleProfileJson, defaultImageModel, defaultVideoModel }), onSuccess: () => { refreshProject(); message.success(text("项目设置已保存", "Project settings saved")); }, onError: (error) => message.error(localizedErrorMessage(error, "项目设置保存失败", "Could not save project settings", locale)) });
    const archiveMutation = useMutation({ mutationFn: () => updateProject(project.id, { status: project.status === "archived" ? "active" : "archived" }), onSuccess: () => { setArchiveOpen(false); refreshProject(); message.success(project.status === "archived" ? text("项目已恢复", "Project restored") : text("项目已归档", "Project archived")); }, onError: (error) => message.error(localizedErrorMessage(error, "项目状态更新失败", "Could not update project status", locale)) });
    const coverMutation = useMutation({ mutationFn: (coverResourceId: string) => updateProject(project.id, { coverResourceId }), onSuccess: (_, coverResourceId) => { setCoverPickerOpen(false); refreshProject(); message.success(coverResourceId ? text("项目主图已更新", "Project cover updated") : text("项目主图已移除", "Project cover removed")); }, onError: (error) => message.error(localizedErrorMessage(error, "项目主图更新失败", "Could not update project cover", locale)) });

    return (
        <div>
            <header className="flex items-end justify-between gap-3 pb-3"><div><h2 className="text-lg font-semibold">{text("项目设置", "Project settings")}</h2><p className="mt-1 text-xs text-foreground/48">{text("基础信息、项目画风与归档管理", "Details, visual style, and archive")}</p></div><Button type={dirty ? "primary" : "default"} icon={dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />} disabled={!dirty || !name.trim()} loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{dirty ? text("保存设置", "Save settings") : text("已保存", "Saved")}</Button></header>

            <section className="py-5">
                <h3 className="mb-3 text-sm font-semibold">{text("基础设置", "Basic settings")}</h3>
                <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label={text("项目名称", "Project name")} className="xl:col-span-2"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
                    <Field label={text("默认画幅", "Default aspect ratio")}><Select className="w-full" value={aspectRatio} options={[{ label: text("9:16 · 竖屏短剧", "9:16 · Vertical"), value: "9:16" }, { label: text("16:9 · 横屏", "16:9 · Widescreen"), value: "16:9" }, { label: text("1:1 · 方形", "1:1 · Square"), value: "1:1" }]} onChange={setAspectRatio} /></Field>
                    <Field label={text("内容来源", "Content source")}><Select className="w-full" value={sourceType} options={[{ label: text("空白开始", "Start blank"), value: "blank" }, { label: text("导入小说", "Import novel"), value: "novel" }, { label: text("粘贴文本", "Paste text"), value: "text" }]} onChange={setSourceType} /></Field>
                    <Field label={text("项目简介", "Description")} className="md:col-span-2 xl:col-span-4"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={text("一句话说明项目目标", "Describe the project goal in one sentence")} /></Field>
                </div>
            </section>

            <section className="border-t border-border/70 py-5">
                <div className="mb-3"><h3 className="text-sm font-semibold">{text("默认生成模型", "Default generation models")}</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">{text("分镜图、动作预演与镜头视频优先使用项目默认；未设置或模型不可用时跟随工作台全局默认。", "Storyboards, previews, and shot videos use project defaults first, then workspace defaults.")}</p></div>
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label={text("默认生图模型", "Default image model")}>
                        <div className="flex items-center gap-2">
                            <ModelPicker config={effectiveConfig} value={defaultImageModel} capability="image" onChange={setDefaultImageModel} fullWidth placeholder={`${text("跟随全局", "Use workspace default")} · ${modelDisplayName(effectiveConfig, effectiveConfig.imageModel) || text("未配置", "Not configured")}`} showSelectedPrice />
                            {defaultImageModel ? <Button type="text" size="small" onClick={() => setDefaultImageModel("")}>{text("跟随全局", "Use default")}</Button> : null}
                        </div>
                    </Field>
                    <Field label={text("默认视频模型", "Default video model")}>
                        <div className="flex items-center gap-2">
                            <ModelPicker config={effectiveConfig} value={defaultVideoModel} capability="video" onChange={setDefaultVideoModel} fullWidth placeholder={`${text("跟随全局", "Use workspace default")} · ${modelDisplayName(effectiveConfig, effectiveConfig.videoModel) || text("未配置", "Not configured")}`} showSelectedPrice />
                            {defaultVideoModel ? <Button type="text" size="small" onClick={() => setDefaultVideoModel("")}>{text("跟随全局", "Use default")}</Button> : null}
                        </div>
                    </Field>
                </div>
            </section>

            <section className="border-t border-border/70 py-5">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{text("项目主图", "Project cover")}</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">{text("项目列表优先展示这张图片；未设置时使用项目画风示意图", "Shown in the project list; the style preview is used when no cover is set")}</p></div><span className="text-[var(--fs-label)] text-foreground/40">{text("建议使用与项目画幅一致的图片", "Use an image matching the project aspect ratio")}</span></div>
                <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-active p-3 sm:flex-row sm:items-center">
                    {project.coverResourceId ? <img src={resourceFileUrl(project.coverResourceId)} alt={locale === "en-US" ? `${project.name} cover` : `${project.name}项目主图`} className="aspect-video w-full shrink-0 rounded-md bg-foreground/5 object-cover sm:w-52" /> : <span className="grid aspect-video w-full shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground/30 sm:w-52"><ImageIcon className="size-6" /></span>}
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium">{project.coverResourceId ? text("已设置项目主图", "Project cover set") : text("尚未设置项目主图", "No project cover set")}</div><p className="mt-1 text-xs leading-5 text-foreground/48">{text("从个人素材库或项目素材库选择，也可以在选择窗口中上传一张新图片。", "Choose from personal or project assets, or upload a new image.")}</p></div>
                    <div className="flex shrink-0 gap-2"><Button icon={<FolderOpen className="size-3.5" />} onClick={() => { setCoverPage(1); setCoverPickerOpen(true); }}>{project.coverResourceId ? text("替换主图", "Replace cover") : text("设置主图", "Set cover")}</Button>{project.coverResourceId ? <Button danger type="text" icon={<Trash2 className="size-3.5" />} loading={coverMutation.isPending} onClick={() => coverMutation.mutate("")}>{text("移除", "Remove")}</Button> : null}</div>
                </div>
            </section>

            <section className="border-t border-border/70 py-5">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{text("项目画风", "Visual style")}</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">{text("项目保存当前版本快照；修改“我的风格”不会自动改写历史项目", "The project keeps a style snapshot; editing My Styles will not update existing projects")}</p></div>{styleProfile ? <span className="text-[var(--fs-label)] text-foreground/52">{styleProfile.source === "user" ? text("来自我的风格", "From My Styles") : styleProfile.source === "external" ? text("外部导入", "Imported") : text("系统预设", "System preset")}</span> : <span className="text-[var(--fs-label)] text-foreground/40">{text("未设置", "Not set")}</span>}</div>
                <div className="flex flex-col gap-3 rounded-lg bg-surface-active p-3 lg:flex-row lg:items-center">
                    {selectedStyle ? <img src={selectedStyle.imageUrl} width="160" height="90" alt={locale === "en-US" ? `${selectedStyle.title} style preview` : `${selectedStyle.title}画风示意`} className="aspect-video w-40 shrink-0 rounded-md object-cover" /> : <span className="grid aspect-video w-40 shrink-0 place-items-center rounded-md bg-foreground/5 text-foreground/35"><Palette className="size-5" /></span>}
                    <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{styleProfile?.title || selectedStyle?.title || text("尚未设置项目画风", "No visual style set")}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/48">{styleProfile?.description || selectedStyle?.description || text("从系统风格开始，或创建可自由编辑的项目视觉规范。", "Start with a preset or create an editable visual style.")}</p>
                        {styleProfile ? <div className="mt-2 flex flex-wrap gap-1">{styleProfile.tags.map((tag) => <span key={tag} className="rounded bg-foreground/10 px-1.5 py-0.5 text-[var(--fs-tiny)] text-foreground/55">{tag}</span>)}</div> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2"><Button icon={<Eye className="size-3.5" />} disabled={!selectedStyle} onClick={() => setStyleDetail(selectedStyle || null)}>{text("查看规范", "View style")}</Button><Button icon={<Pencil className="size-3.5" />} disabled={!styleProfile} onClick={() => { setStyleEditorRequested(true); setStylePickerOpen(true); }}>{text("编辑画风", "Edit style")}</Button><Button icon={<Palette className="size-3.5" />} onClick={() => { setStyleEditorRequested(false); setStylePickerOpen(true); }}>{selectedStyle ? text("更换画风", "Change style") : text("选择画风", "Choose style")}</Button></div>
                </div>
                {styleProfile ? <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5"><StyleMetric label={text("执行策略", "Execution policy")} value={styleProfile.executionPolicy === "strict-assets" ? text("严格校验", "Strict assets") : text("兼容降级", "Allow fallback")} /><StyleMetric label={text("绑定资产", "Linked assets")} value={locale === "en-US" ? `${styleProfile.assets.length}` : `${styleProfile.assets.length} 个`} /><StyleMetric label={text("已启用", "Enabled")} value={locale === "en-US" ? `${enabledStyleAssets.length}` : `${enabledStyleAssets.length} 个`} /><StyleMetric label={text("图片执行", "Image execution")} value={styleExecutionStatusLabel(styleExecutionPlans?.image.status, locale)} /><StyleMetric label={text("视频执行", "Video execution")} value={styleExecutionStatusLabel(styleExecutionPlans?.video.status, locale)} /></div> : null}
                {styleExecutionPlans && (styleExecutionPlans.image.warnings.length || styleExecutionPlans.video.warnings.length) ? <div className="mt-2 grid gap-1 rounded-md bg-amber-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-amber-600 dark:text-amber-400">{styleExecutionPlans.image.warnings.length ? <p>{text("图片", "Image")}: {styleExecutionPlans.image.warnings.join("; ")}</p> : null}{styleExecutionPlans.video.warnings.length ? <p>{text("视频", "Video")}: {styleExecutionPlans.video.warnings.join("; ")}</p> : null}</div> : null}
            </section>

            <section className="py-4">
                <div className="flex flex-col gap-3 rounded-lg bg-red-500/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded bg-red-500/10 text-red-500"><Archive className="size-3.5" /></span><div className="min-w-0"><h3 className="text-sm font-medium">{project.status === "archived" ? text("恢复项目", "Restore project") : text("归档项目", "Archive project")}</h3><p className="mt-0.5 text-[var(--fs-label)] text-foreground/48">{project.status === "archived" ? text("恢复后可继续创建章节、画布和生成任务", "Restore to create chapters, canvases, and generation tasks") : text("保留全部章节、画布和资产，停止项目内新建与生成", "Keep all content, but stop new work and generation in this project")}</p></div></div>
                    <Button size="small" danger={project.status !== "archived"} icon={project.status === "archived" ? <Check className="size-3.5" /> : <ShieldAlert className="size-3.5" />} onClick={() => setArchiveOpen(true)}>{project.status === "archived" ? text("恢复项目", "Restore project") : text("归档项目", "Archive project")}</Button>
                </div>
            </section>

            <Modal className="workspace-modal workspace-modal-compact" title={project.status === "archived" ? text("恢复项目", "Restore project") : text("归档项目", "Archive project")} open={archiveOpen} okText={project.status === "archived" ? text("确认恢复", "Restore") : text("确认归档", "Archive")} cancelText={text("取消", "Cancel")} okButtonProps={{ danger: project.status !== "archived", loading: archiveMutation.isPending }} onCancel={() => setArchiveOpen(false)} onOk={() => archiveMutation.mutate()} styles={{ body: { paddingTop: 12 } }}><p className="m-0 text-sm leading-6 text-foreground/65">{project.status === "archived" ? text("恢复后项目会重新进入可编辑状态。", "The project will become editable again.") : text("归档不会删除章节、画布或资产，画布文档仍可在创作画布中打开。", "Archiving keeps chapters, canvases, and assets. Canvases remain available in your workspace.")}</p></Modal>
            <AssetLibraryPickerModal
                open={coverPickerOpen}
                items={coverPickerItems}
                mediaKinds={["image"]}
                categoryLabels={{ all: text("全部图片", "All images"), image: text("图片", "Images") }}
                initialCategory="image"
                initialSelectedIds={currentCoverItemId ? [currentCoverItemId] : []}
                multiple={false}
                eyebrow={text("项目设置", "Project settings")}
                title={text("选择项目主图", "Choose project cover")}
                confirmLabel={() => text("设为项目主图", "Set as project cover")}
                emptyTitle={text("素材库还没有图片", "No images in the asset library")}
                emptyDescription={text("可以从底部上传一张新图片，上传后会自动选中。", "Upload a new image below. It will be selected automatically.")}
                loading={coverAssetsQuery.isLoading}
                pagination={{ current: coverPage, pageSize: coverPageSize, total: coverAssetsQuery.data?.total || 0, onChange: (nextPage, nextPageSize) => { setCoverPage(nextPageSize !== coverPageSize ? 1 : nextPage); setCoverPageSize(nextPageSize); } }}
                upload={{ accept: "image/png,image/jpeg,image/webp,image/avif", description: text("支持 PNG、JPG、WebP、AVIF", "PNG, JPG, WebP, or AVIF"), onUpload: async (files) => {
                    const file = Array.from(files)[0];
                    if (!file?.type.startsWith("image/")) throw new Error(text("请选择图片文件", "Choose an image file"));
                    const uploaded = await uploadImage(file);
                    const resourceId = resourceIdFromStorageKey(uploaded.storageKey);
                    if (!resourceId) throw new Error(text("图片上传未同步到服务端资源库，请检查后端连接", "Image was not synced to the server. Check your connection."));
                    const id = addAsset({ kind: "image", title: file.name.replace(/\.[^.]+$/, "") || text("项目主图", "Project cover"), coverUrl: uploaded.url, tags: [text("项目主图", "Project cover")], status: "confirmed", source: text("项目设置", "Project settings"), data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType } });
                    return [id];
                } }}
                onClose={() => setCoverPickerOpen(false)}
                onConfirm={async (ids) => {
                    const id = ids[0];
                    let resourceId = coverResourceByItemIdRef.current.get(id);
                    if (!resourceId) {
                        const asset = useAssetStore.getState().assets.find((entry) => entry.id === id);
                        resourceId = asset?.kind === "image" ? resourceIdFromStorageKey(asset.data.storageKey) : "";
                    }
                    if (!resourceId) throw new Error(text("所选图片尚未同步到服务端资源库", "Selected image has not synced to the server"));
                    await coverMutation.mutateAsync(resourceId);
                }}
            />
            <CanvasStylePickerModal open={stylePickerOpen} value={stylePresetId} currentProfile={styleProfile} startInEditor={styleEditorRequested} onClose={() => { setStylePickerOpen(false); setStyleEditorRequested(false); }} onSelect={(preset) => { applyStyle(preset); setStylePickerOpen(false); setStyleEditorRequested(false); }} />
            <CanvasStyleDetailModal open={Boolean(styleDetail)} preset={styleDetail} selected={styleDetail?.id === stylePresetId} onClose={() => setStyleDetail(null)} onSelect={(preset) => { applyStyle(preset); setStyleDetail(null); }} />
        </div>
    );

    function applyStyle(preset: CanvasStylePreset) {
        setStylePresetId(preset.id);
        setStyleProfileJson(serializeStyleProfile(preset.profile || createStyleProfileSnapshot(preset)));
    }
}

function StyleMetric({ label, value }: { label: string; value: string }) {
    return <div className="min-w-0 rounded-md bg-surface-active px-3 py-2"><span className="block text-[var(--fs-tiny)] text-foreground/40">{label}</span><span className="mt-0.5 block truncate font-medium text-foreground/65">{value}</span></div>;
}

function styleExecutionStatusLabel(status: "ready" | "degraded" | "blocked" | undefined, locale: AppLocale) {
    return locale === "en-US" ? status === "blocked" ? "Unavailable" : status === "degraded" ? "Fallback" : "Ready" : status === "blocked" ? "不可执行" : status === "degraded" ? "降级执行" : "完整执行";
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/62">{label}</span>{children}</label>;
}
