import { Checkbox, Input, Modal, Popover } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useMemo, useState } from "react";

import { Image as ImageIcon, Music2, Play, Plus, UserRound } from "lucide-react";

import { CanvasVideoPreviewImage } from "@/components/canvas/canvas-video-preview-image";
import { isStoryboardBindableAsset, storyboardAssetRoleForNode } from "@/lib/canvas/canvas-storyboard-assets";
import { isStoryboardPreviewAsset, MAX_STORYBOARD_ROW_ASSETS, setStoryboardAssetBinding } from "@/lib/canvas/canvas-storyboard-materializer";
import { useLocaleText } from "@/lib/i18n";
import { resolveMediaUrl } from "@/services/file-storage";
import { CanvasNodeType, type CanvasNodeData, type StoryboardAssetBinding } from "@/types/canvas";

const ROLE_LABELS: Record<StoryboardAssetBinding["role"], string> = {
    character: "角色",
    environment: "场景",
    wardrobe: "服装",
    prop: "道具",
    weapon: "武器",
    style: "风格",
    motion: "动态",
    audio: "音频",
};
const ROLE_LABELS_EN: Record<StoryboardAssetBinding["role"], string> = {
    character: "Character",
    environment: "Scene",
    wardrobe: "Wardrobe",
    prop: "Prop",
    weapon: "Weapon",
    style: "Style",
    motion: "Motion",
    audio: "Audio",
};

export function StoryboardAssetsCell({ bindings, nodes, limit = 4, onChange, onOpenProjectAssets }: { bindings: StoryboardAssetBinding[]; nodes: CanvasNodeData[]; limit?: number; onChange?: (bindings: StoryboardAssetBinding[]) => void; onOpenProjectAssets?: () => void }) {
    const { text } = useLocaleText();
    const [previewNode, setPreviewNode] = useState<CanvasNodeData | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [query, setQuery] = useState("");
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const assets = bindings.map((binding) => ({ binding, node: nodeById.get(binding.nodeId) })).filter((item) => !item.node || isStoryboardPreviewAsset(item.node));
    const visible = assets.slice(0, limit);
    const hiddenCount = Math.max(0, assets.length - visible.length);
    const selectableNodes = pickerOpen ? nodes.filter((node) => isStoryboardBindableAsset(node) || bindings.some((binding) => binding.nodeId === node.id)) : [];
    const matchingNodes = selectableNodes.filter((node) => node.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const missingBindings = pickerOpen ? bindings.filter((binding) => !nodeById.has(binding.nodeId) && text("资产已失效", "Missing asset").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];

    return (
        <>
            <div className="flex min-w-0 items-center gap-1.5" aria-label={text(`已关联 ${assets.length} 个资产`, `${assets.length} linked assets`)}>
                {!assets.length ? <span className="truncate text-[var(--fs-caption)] text-foreground/35">{text("未关联", "None")}</span> : null}
                {visible.map(({ binding, node }) => (
                    <Tooltip key={binding.nodeId} title={`${node?.title || text("资产已失效", "Missing asset")} · ${text(ROLE_LABELS[binding.role], ROLE_LABELS_EN[binding.role])}`}>
                        <button
                            type="button"
                            data-icon-only
                            disabled={!node}
                            className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-foreground/10 bg-foreground/[0.035] text-foreground/45 outline-none transition enabled:hover:border-foreground/30 enabled:hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed"
                            aria-label={text(`预览${node?.title || "失效资产"}`, `Preview ${node?.title || "missing asset"}`)}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (node) setPreviewNode(node);
                            }}
                        >
                            {node ? <AssetThumbnail node={node} /> : <ImageIcon className="size-4" />}
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 text-[8px] leading-3 text-white">{text(ROLE_LABELS[binding.role], ROLE_LABELS_EN[binding.role]).slice(0, 1)}</span>
                        </button>
                    </Tooltip>
                ))}
                {hiddenCount ? <span className="shrink-0 text-[var(--fs-caption)] font-medium text-foreground/45">+{hiddenCount}</span> : null}
                {onChange ? (
                    <Popover
                        trigger="click"
                        placement="bottomRight"
                        open={pickerOpen}
                        onOpenChange={setPickerOpen}
                        content={(
                            <div className="w-72 max-w-[calc(100vw-48px)]" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()}>
                                <div className="mb-2 flex items-center justify-between text-xs font-medium">
                                    <span>{text("画布资产", "Canvas assets")}</span>
                                    <span className="text-foreground/45">{bindings.length}/{MAX_STORYBOARD_ROW_ASSETS}</span>
                                </div>
                                <Input.Search
                                    size="small"
                                    allowClear
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder={text("搜索资产", "Search assets")}
                                    aria-label={text("搜索画布资产", "Search canvas assets")}
                                />
                                <div className="mt-2 max-h-56 overflow-y-auto" data-canvas-wheel-scroll onWheel={(event) => event.stopPropagation()}>
                                    {matchingNodes.map((candidate) => {
                                        const checked = bindings.some((binding) => binding.nodeId === candidate.id);
                                        const role = storyboardAssetRoleForNode(candidate);
                                        return (
                                            <div key={candidate.id} className="flex min-h-9 items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-foreground/[0.05]">
                                                <Checkbox
                                                    className="min-w-0 flex-1"
                                                    checked={checked}
                                                    disabled={!checked && bindings.length >= MAX_STORYBOARD_ROW_ASSETS}
                                                    onChange={(event) => onChange(setStoryboardAssetBinding(bindings, candidate, event.target.checked))}
                                                >
                                                    <span className="block truncate" title={candidate.title}>{candidate.title || text("未命名资产", "Untitled asset")}</span>
                                                </Checkbox>
                                                {role ? <span className="shrink-0 text-foreground/45">{text(ROLE_LABELS[role], ROLE_LABELS_EN[role])}</span> : null}
                                            </div>
                                        );
                                    })}
                                    {missingBindings.map((binding) => (
                                        <div key={binding.nodeId} className="flex min-h-9 items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-foreground/[0.05]">
                                            <Checkbox className="min-w-0 flex-1" checked onChange={() => onChange(bindings.filter((item) => item.nodeId !== binding.nodeId))}>
                                                <span className="block truncate text-foreground/45">{text("资产已失效", "Missing asset")}</span>
                                            </Checkbox>
                                        </div>
                                    ))}
                                    {!matchingNodes.length && !missingBindings.length ? <div className="py-3 text-center text-xs text-foreground/45">{text("没有匹配的画布资产", "No matching canvas assets")}</div> : null}
                                </div>
                                {onOpenProjectAssets ? (
                                    <button
                                        type="button"
                                        className="mt-2 flex h-8 w-full items-center gap-2 border-t px-1.5 pt-1 text-xs hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-45"
                                        disabled={bindings.length >= MAX_STORYBOARD_ROW_ASSETS}
                                        onClick={() => { setPickerOpen(false); onOpenProjectAssets(); }}
                                    >
                                        <Plus className="size-3.5" />
                                        {text("从资产库引入", "Add from asset library")}
                                    </button>
                                ) : null}
                            </div>
                        )}
                    >
                        <button
                            type="button"
                            data-icon-only
                            className="grid size-7 shrink-0 place-items-center rounded border border-foreground/15 text-foreground/55 outline-none transition hover:border-foreground/35 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                            aria-label={text("添加或移除关联资产", "Add or remove linked assets")}
                            title={text("添加或移除关联资产", "Add or remove linked assets")}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <Plus className="size-3.5" />
                        </button>
                    </Popover>
                ) : null}
            </div>
            <AssetPreviewModal node={previewNode} onClose={() => setPreviewNode(null)} />
        </>
    );
}

function AssetThumbnail({ node }: { node: CanvasNodeData }) {
    const source = useNodeMediaSource(node.type === CanvasNodeType.Video ? null : node);
    if (node.type === CanvasNodeType.Audio) return <Music2 className="size-4" />;
    if (node.metadata?.workflowKind === "character" && !source) return <UserRound className="size-4" />;
    if (node.type === CanvasNodeType.Video) {
        return (
            <>
                <CanvasVideoPreviewImage node={node} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" fallback={<Play className="size-4" />} />
                <span className="absolute inset-0 grid place-items-center bg-black/15"><Play className="size-3.5 fill-white text-white" /></span>
            </>
        );
    }
    return source ? <img src={source} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" /> : <ImageIcon className="size-4" />;
}

function AssetPreviewModal({ node, onClose }: { node: CanvasNodeData | null; onClose: () => void }) {
    const source = useNodeMediaSource(node);
    return (
        <Modal title={node?.title || "资产预览"} open={Boolean(node)} onCancel={onClose} footer={null} width={880} centered destroyOnHidden>
            {node ? (
                <div className="grid min-h-56 place-items-center overflow-hidden rounded-lg bg-black/[0.035] p-3 dark:bg-white/[0.035]" data-canvas-no-zoom>
                    {node.type === CanvasNodeType.Video && source ? <video src={source} controls autoPlay playsInline className="max-h-[68vh] max-w-full rounded-md" />
                        : node.type === CanvasNodeType.Audio && source ? <audio src={source} controls autoPlay className="w-full max-w-xl" />
                            : source ? <img src={source} alt={node.title || "资产预览"} className="max-h-[68vh] max-w-full object-contain" />
                                : <span className="text-sm text-foreground/45">当前资产没有可预览的媒体内容</span>}
                </div>
            ) : null}
        </Modal>
    );
}

function useNodeMediaSource(node: CanvasNodeData | null) {
    const fallback = node ? node.metadata?.workflowKind === "character"
        ? node.metadata.characterCoverUrl || ""
        : node.type === CanvasNodeType.Drawing
            ? node.metadata?.drawingPreviewUrl || node.metadata?.content || ""
            : node.metadata?.content || "" : "";
    const storageKey = node?.metadata?.storageKey;
    const [source, setSource] = useState(fallback);
    useEffect(() => {
        let cancelled = false;
        setSource(fallback);
        if (storageKey) void resolveMediaUrl(storageKey, fallback).then((url) => {
            if (!cancelled) setSource(url || fallback);
        }).catch(() => {
            if (!cancelled) setSource(fallback);
        });
        return () => { cancelled = true; };
    }, [fallback, storageKey]);
    return source;
}
