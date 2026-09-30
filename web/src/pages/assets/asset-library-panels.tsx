// 素材库的批量操作条、空态、筛选组、详情抽屉与图片放大。

import { Button, Drawer, Tag } from "antd";
import { Box, CheckCheck, Clapperboard, Copy, Download, FileText, FileUp, Link2, Maximize2, Plus, RotateCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { assetCategoryLabel } from "@/lib/asset-category";
import { formatBytes } from "@/lib/image-utils";
import { useRef, useState } from "react";
import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { type LibraryAsset, assetKindIcons } from "./asset-library-format";
import { isKnownAssetKind } from "./asset-library-cards";
import { assetDownloadLabel, assetKindLabel, assetProjectLabel, assetSizeLabel, formatAssetClock, formatAssetDateTime } from "./asset-library-format";
import { useLocaleText, type AppLocale } from "@/lib/i18n";

export function AssetsBatchBar({
    count,
    isTrash = false,
    allSelected,
    onSelectAll,
    onClear,
    onExport,
    onRestore,
    onArchive,
    onDelete,
}: {
    count: number;
    isTrash?: boolean;
    allSelected: boolean;
    onSelectAll: () => void;
    onClear: () => void;
    onExport: () => void;
    onRestore?: () => void;
    onArchive?: () => void;
    onDelete: () => void;
}) {
    const { text } = useLocaleText();
    return (
        <div className="assets-batch-bar" role="toolbar" aria-label={text("批量操作", "Batch actions")}>
            <span className="assets-batch-count">
                {text("已选择", "Selected")} <strong>{count}</strong> {text("个素材", "assets")}
            </span>
            <div className="assets-batch-actions">
                <Button size="small" icon={<CheckCheck className="size-3.5" />} disabled={allSelected} onClick={onSelectAll}>
                    {text("全选", "Select all")}
                </Button>
                <Button size="small" onClick={onClear}>
                    {text("取消选择", "Clear selection")}
                </Button>
                {isTrash ? (
                    <>
                        <Button size="small" type="primary" icon={<RotateCcw className="size-3.5" />} onClick={onRestore}>
                            {text("还原已选", "Restore selected")}
                        </Button>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                            {text("彻底删除已选", "Delete selected permanently")}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button size="small" icon={<Download className="size-3.5" />} onClick={onExport}>
                            {text("导出", "Export")}
                        </Button>
                        <Button size="small" icon={<Trash2 className="size-3.5 text-amber-500" />} onClick={onArchive}>
                            {text("移入回收站", "Move to trash")}
                        </Button>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                            {text("彻底删除", "Delete permanently")}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

export const assetsEmptyBannerFrames = [
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: "ASSET.01 · 天台重逢" },
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: "ASSET.02 · 雨夜霓虹" },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: "ASSET.03 · 暗巷追逐" },
];

export function AssetsEmptyState({ onNew, onImport, onGoCanvas }: { onNew: () => void; onImport: () => void; onGoCanvas: () => void }) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const { text } = useLocaleText();
    return (
        <div className="assets-empty">
            <div className="assets-empty-banner" aria-hidden="true">
                {assetsEmptyBannerFrames.map((frame, index) => (
                    <figure key={frame.caption} className={`assets-empty-banner-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                        <img src={frame.src} alt="" loading="lazy" decoding="async" />
                        <span>{frame.caption}</span>
                    </figure>
                ))}
                <span className="assets-empty-banner-caption">
                    <span>{brandName} {text("素材库", "Asset library")}</span>{text("把每次创作的结果，留档成可复用的资产", "Keep every result as a reusable asset")}
                </span>
            </div>
            <div className="assets-empty-cards">
                <button type="button" className="assets-empty-card" onClick={onNew}>
                    <span className="assets-empty-card-icon">
                        <Plus />
                    </span>
                    <strong>{text("新建素材", "New asset")}</strong>
                    <span>{text("录入提示词、说明文案，或上传图片资产。", "Add prompts, notes, or images.")}</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onImport}>
                    <span className="assets-empty-card-icon">
                        <FileUp />
                    </span>
                    <strong>{text("导入素材包", "Import asset package")}</strong>
                    <span>{text("从素材压缩包一键恢复旧资产，继续创作。", "Restore assets from an archive.")}</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onGoCanvas}>
                    <span className="assets-empty-card-icon">
                        <Clapperboard />
                    </span>
                    <strong>{text("去画布保存", "Save from canvas")}</strong>
                    <span>{text("把画布上满意的镜头与画面留档进素材库。", "Keep selected shots and images from the canvas.")}</span>
                </button>
            </div>
        </div>
    );
}

export function AssetFilterGroup({
    title,
    options,
    value,
    counts,
    onChange,
    className = "",
}: {
    title: string;
    options: Array<{ label: string; value: string }>;
    value: string;
    counts: Map<string, number>;
    onChange: (value: string) => void;
    className?: string;
}) {
    return (
        <div className={`collection-filter-group ${className}`}>
            <span className="collection-filter-label">{title}</span>
            <div className="collection-filter-options">
                {options.map((option) => {
                    const active = value === option.value;
                    return (
                        <button key={option.value} type="button" aria-pressed={active} className={`assets-filter-item ${active ? "is-active" : ""}`} onClick={() => onChange(option.value)}>
                            <span className="assets-filter-item-label">{option.label}</span>
                            <span className="assets-filter-count">{counts.get(option.value) || 0}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: LibraryAsset | null; onClose: () => void; onCopy: (asset: LibraryAsset) => void; onDownload: (asset: LibraryAsset) => void }) {
    const { locale, text } = useLocaleText();
    const facts = asset ? assetArchiveFacts(asset, locale) : [];
    const kind = asset && isKnownAssetKind(asset.kind) ? asset.kind : undefined;
    const KindIcon = asset ? (kind ? assetKindIcons[kind] : FileText) : Clapperboard;
    return (
        <Drawer className="library-drawer" title={text("素材档案", "Asset details")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-4">
                    <div className="asset-archive-header">
                        <span className="asset-archive-header-icon">
                            <KindIcon />
                        </span>
                        <div className="min-w-0">
                            <h2 className="asset-archive-title">{asset.title}</h2>
                            <p className="asset-archive-subtitle">
                                {assetCategoryLabel(asset.category, locale)} · {formatAssetDateTime(asset.createdAt, locale)} {text("创建", "created")}
                            </p>
                        </div>
                    </div>
                    <div className="asset-archive-preview">
                        {asset.kind === "text" ? (
                            <div className="asset-archive-preview-note">{asset.data.content}</div>
                        ) : asset.kind === "audio" ? (
                            <div className="asset-archive-audio">
                                <audio src={asset.data.url} controls />
                            </div>
                        ) : asset.kind === "model" ? (
                            <div className="asset-archive-preview-model">
                                <Box />
                                <span>
                                    {asset.data.fileName} · {formatBytes(asset.data.bytes)}
                                </span>
                            </div>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="asset-archive-preview-media" />
                        ) : (
                            <AssetImageZoom asset={asset} />
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {(asset.tags || []).map((tag) => (
                            <Tag key={tag} className="m-0">
                                {tag}
                            </Tag>
                        ))}
                        {asset.arkAssetId ? (
                            <Tag className="m-0" color="geekblue" title={text("火山方舟素材 ID，生成视频时可直接 asset:// 引用", "Ark asset ID for video generation via asset://")}>
                                {text("方舟", "Ark")} {asset.arkAssetId}
                            </Tag>
                        ) : null}
                        <StorageTag asset={asset} />
                    </div>
                    <div className="asset-archive-facts">
                        {facts.map((fact) => (
                            <div key={fact.label} className="asset-archive-fact">
                                <span className="asset-archive-fact-label">{fact.label}</span>
                                <span className="asset-archive-fact-value" title={fact.value}>
                                    {fact.value}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="asset-archive-link">
                        <Link2 />
                        <span>{text("所属项目", "Project")}</span>
                        <strong>{assetProjectLabel(asset, locale)}</strong>
                    </div>
                    {asset.note ? (
                        <div className="asset-archive-section">
                            <span className="asset-archive-section-title">{text("备注", "Notes")}</span>
                            <p className="asset-archive-section-body">{asset.note}</p>
                        </div>
                    ) : null}
                    <div className="asset-archive-actions">
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {text("复制文本", "Copy text")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {assetDownloadLabel(asset, locale)}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Drawer>
    );
}

export function AssetImageZoom({ asset }: { asset: LibraryAsset & { kind: "image" } }) {
    const { text } = useLocaleText();
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const reset = () => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
    };
    return (
        <div
            className="asset-zoom-viewer"
            onWheel={(event) => {
                event.preventDefault();
                setScale((value) => Math.min(4, Math.max(0.25, value * (event.deltaY < 0 ? 1.12 : 0.89))));
            }}
            onPointerDown={(event) => {
                if (scale <= 1) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
            }}
            onPointerUp={() => {
                dragRef.current = null;
            }}
            onPointerCancel={() => {
                dragRef.current = null;
            }}
        >
            <img src={asset.coverUrl || asset.data.dataUrl} alt={asset.title} loading="lazy" decoding="async" className="asset-archive-preview-media asset-zoom-image" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
            <div className="asset-zoom-controls" data-canvas-no-zoom>
                <button type="button" title={text("缩小", "Zoom out")} aria-label={text("缩小", "Zoom out")} onClick={() => setScale((value) => Math.max(0.25, value / 1.25))}>
                    <ZoomOut className="size-4" />
                </button>
                <button type="button" title={text("恢复适应", "Fit image")} aria-label={text("恢复适应", "Fit image")} onClick={reset}>
                    {Math.round(scale * 100)}%
                </button>
                <button type="button" title={text("放大", "Zoom in")} aria-label={text("放大", "Zoom in")} onClick={() => setScale((value) => Math.min(4, value * 1.25))}>
                    <ZoomIn className="size-4" />
                </button>
                <button type="button" title={text("查看原图尺寸", "Actual size")} aria-label={text("查看原图尺寸", "Actual size")} onClick={() => setScale(1)}>
                    <Maximize2 className="size-4" />
                </button>
            </div>
        </div>
    );
}

export function assetArchiveFacts(asset: LibraryAsset, locale: AppLocale = "zh-CN") {
    const facts: Array<{ label: string; value: string }> = [
        { label: locale === "en-US" ? "Type" : "类型", value: assetKindLabel(asset.kind, locale) },
        { label: locale === "en-US" ? "Category" : "分类", value: assetCategoryLabel(asset.category, locale) },
    ];
    if (asset.kind === "image" || asset.kind === "video") {
        facts.push({ label: locale === "en-US" ? "Dimensions" : "尺寸", value: assetSizeLabel(asset.data.width, asset.data.height, locale) });
    }
    if (asset.kind === "video" || asset.kind === "audio") {
        facts.push({ label: locale === "en-US" ? "Duration" : "时长", value: formatAssetClock(asset.data.durationMs) || (locale === "en-US" ? "Unknown" : "未知") });
    }
    if (asset.kind !== "text") {
        facts.push({ label: locale === "en-US" ? "Size" : "大小", value: formatBytes(asset.data.bytes) });
        facts.push({ label: locale === "en-US" ? "Format" : "格式", value: asset.data.mimeType });
        facts.push({ label: locale === "en-US" ? "Storage" : "存储", value: resourceStorageLabel(asset.data.storageKey) });
    }
    facts.push({ label: locale === "en-US" ? "Source" : "来源", value: asset.source || (locale === "en-US" ? "Not specified" : "未标注") });
    facts.push({ label: locale === "en-US" ? "Created" : "创建", value: formatAssetDateTime(asset.createdAt, locale) });
    facts.push({ label: locale === "en-US" ? "Updated" : "更新", value: formatAssetDateTime(asset.updatedAt, locale) });
    return facts;
}

export function StorageTag({ asset }: { asset: LibraryAsset }) {
    if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return null;
    const location = resourceStorageLocation(asset.data.storageKey);
    const color = location === "oss" ? "green" : location === "local" ? "gold" : "default";
    return (
        <Tag color={color} className="m-0 text-[var(--fs-label)]" title={resourceStorageTitle(asset.data.storageKey)}>
            {resourceStorageLabel(asset.data.storageKey)}
        </Tag>
    );
}
