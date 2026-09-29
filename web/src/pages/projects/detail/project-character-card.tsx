import { Button, Dropdown, Popconfirm } from "antd";
import { Image as ImageIcon, MoveRight, Pencil, Sparkles, Trash2, UserRound, Volume2 } from "lucide-react";
import type { ReactNode } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectAsset } from "@/services/api/projects";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { useLocaleText } from "@/lib/i18n";

import { projectCharacterCover } from "./project-character-cover";
import { textValue } from "./shared";

export function ProjectCharacterCard({ asset, folderItems, generating, removing, onOpen, onEdit, onGenerate, onBindImages, onBindVoice, onMove, onRemove }: {
    asset: ProjectAsset;
    folderItems: Array<{ key: string; label: string }>;
    generating: boolean;
    removing: boolean;
    onOpen: () => void;
    onEdit: () => void;
    onGenerate: () => void;
    onBindImages: () => void;
    onBindVoice: () => void;
    onMove: (folderId: string) => void;
    onRemove: () => void;
}) {
    const { text } = useLocaleText();
    const character = asset.character;
    const cover = projectCharacterCover(character?.representations);
    const role = textValue(character?.definition.role) || text("未填写剧情定位", "Story role not set");
    const appearance = textValue(character?.definition.appearance) || textValue(character?.definition.consistencyPrompt) || text("角色设定待完善", "Character details incomplete");
    const imageStatus = character?.visualStatus === "ready" ? text("图片已绑定", "Image linked") : character?.visualStatus === "partial" ? text("图片待补全", "Image incomplete") : text("图片未绑定", "No image linked");
    const voiceStatus = character?.voiceStatus === "ready" ? text(`声音已绑定 · ${character.voice?.profile.name}`, `Voice linked · ${character.voice?.profile.name}`) : character?.voiceStatus === "unavailable" ? text("声音需处理", "Voice needs attention") : text("声音未绑定", "No voice linked");
    const readinessLabel = character?.visualStatus === "ready" ? character.voiceStatus === "ready" ? text("可直接用于生成", "Ready to generate") : text("形象已就绪", "Visual ready") : text("设定进行中", "In progress");
    return (
        <AssetLibraryCard className="project-character-card">
            <AssetLibraryCardMedia className="relative aspect-[3/2] overflow-hidden bg-foreground/[.045]">
                <button type="button" className="project-asset-media-button" onClick={onOpen} aria-label={text(`查看角色卡：${asset.title}`, `View character card: ${asset.title}`)}>
                    {cover ? <CachedResourceImage storageKey={`resource:${cover.resourceId}`} src={resourceFileUrl(cover.resourceId)} alt={asset.title} loading="lazy" decoding="async" className="h-full w-full object-contain p-1" fallback={<div className="grid h-full place-items-center"><span className="grid size-14 place-items-center rounded-lg border border-border/70 bg-background/75 text-foreground/24"><UserRound className="size-7" /></span></div>} /> : <div className="grid h-full place-items-center"><span className="grid size-14 place-items-center rounded-lg border border-border/70 bg-background/75 text-foreground/24"><UserRound className="size-7" /></span></div>}
                </button>
                <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2">
                    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[var(--fs-micro)] font-medium text-white">{text("角色卡", "Character")} · v{character?.version || 1}</span>
                    <span className="rounded bg-black/60 px-1.5 py-0.5 text-[var(--fs-micro)] text-white">{readinessLabel}</span>
                </div>
            </AssetLibraryCardMedia>
            <div className="p-3">
                <div className="flex items-start justify-between gap-3"><button type="button" className="project-character-title-button" onClick={onOpen}><h3 className="truncate text-sm font-semibold">{asset.title}</h3><p className="mt-0.5 truncate text-[var(--fs-label)] text-foreground/48">{role}</p></button><Button type="text" size="small" className="!h-7 !px-1.5" icon={<Pencil className="size-3.5" />} onClick={onEdit} aria-label={text(`编辑 ${asset.title}`, `Edit ${asset.title}`)} /></div>
                <p className="mt-2 line-clamp-2 min-h-9 text-[var(--fs-label)] leading-[18px] text-foreground/55">{appearance}</p>
                <div className="mt-2 grid gap-1.5">
                    <StatusLine icon={<ImageIcon className="size-3.5" />} ready={character?.visualStatus === "ready"} label={imageStatus} action={character?.visualStatus === "ready" ? text("更换", "Replace") : text("初始化", "Generate")} onClick={character?.visualStatus === "ready" ? onBindImages : onGenerate} />
                    <StatusLine icon={<Volume2 className="size-3.5" />} ready={character?.voiceStatus === "ready"} label={voiceStatus} action={character?.voiceStatus === "ready" ? text("调整", "Change") : text("选择", "Choose")} onClick={onBindVoice} />
                </div>
                <div className="mt-3 flex min-w-0 gap-2 border-t border-border/60 pt-2">
                    <Button size="small" className="min-w-0 flex-1" icon={<Sparkles className="size-3.5" />} loading={generating} disabled={removing} onClick={onGenerate}>{character?.visualStatus === "missing" ? text("初始化三视图", "Generate turnaround") : text("重新生成三视图", "Regenerate turnaround")}</Button><Dropdown trigger={["click"]} menu={{ selectedKeys: [asset.folderId || ""], items: folderItems, onClick: ({ key }) => onMove(key) }}><Button type="text" size="small" disabled={generating || removing} icon={<MoveRight className="size-3.5" />} aria-label={text(`移动 ${asset.title}`, `Move ${asset.title}`)} /></Dropdown><Popconfirm title={text("移出项目角色？", "Remove character from project?")} description={text("已有画布或镜头引用时将无法移出。", "Characters referenced by canvases or shots cannot be removed.")} okText={text("移出", "Remove")} cancelText={text("取消", "Cancel")} onConfirm={onRemove}><Button type="text" danger size="small" loading={removing} disabled={generating} icon={<Trash2 className="size-3.5" />} aria-label={text(`移出 ${asset.title}`, `Remove ${asset.title}`)} /></Popconfirm>
                </div>
            </div>
        </AssetLibraryCard>
    );
}

function StatusLine({ icon, ready, label, action, onClick }: { icon: ReactNode; ready: boolean; label: string; action: string; onClick: () => void }) {
    return <div className={`flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-[var(--fs-tiny)] ${ready ? "border-emerald-500/20 bg-emerald-500/[.06] text-emerald-700 dark:text-emerald-300" : "border-border/70 bg-foreground/[.025] text-foreground/48"}`}><span className="shrink-0">{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span><button type="button" className="shrink-0 font-medium text-[var(--workspace-accent)] hover:underline" onClick={onClick}>{action}</button></div>;
}
