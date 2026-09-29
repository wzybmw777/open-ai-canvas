import { App, Button, Dropdown, Popconfirm } from "antd";
import type { MenuProps } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Check, ChevronDown, FileText, FolderOpen, HardDrive, Image as ImageIcon, LoaderCircle, Music2, Puzzle, RotateCcw, Search, Trash2, Upload, UserRound, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUserStore } from "@/stores/use-user-store";

import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AssetLibraryCard } from "@/components/assets/asset-library-card";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { PaginationBar } from "@/components/layout/workspace-page";
import { cn } from "@/lib/utils";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { ASSET_CATEGORIES, assetCategoryLabel } from "@/lib/asset-category";
import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { deleteAssetsWithRemoteSync, loadAssetLibraryPage, localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";

export type AssetPickerMediaKind = "image" | "video" | "audio" | "text";

export const ASSET_PICKER_MEDIA_KIND_LABELS: Record<AssetPickerMediaKind, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };

const DEFAULT_MEDIA_KINDS: AssetPickerMediaKind[] = ["image", "video", "audio"];

export type AssetLibraryPickerItem = {
    id: string;
    title: string;
    category: string;
    archived?: boolean;
    kindLabel: string;
    /** 媒体类型筛选依据；缺省时按本地素材或插件素材的 kind 推断。 */
    mediaKind?: AssetPickerMediaKind;
    asset?: Asset;
    imageUrl?: string;
    imageStorageKey?: string;
    imageFit?: "cover" | "contain";
    description?: string;
    searchText?: string;
    disabledReason?: string;
    folderId?: string;
    external?: ExternalAssetPickerReference;
};

export type AssetLibraryPickerFolder = {
    id: string;
    parentId?: string;
    name: string;
};

type Props = {
    remoteLibrary?: boolean;
    remoteKind?: string;
    /** 左侧「媒体类型」筛选项；只有一种类型或已由 remoteKind 固定时不展示该分组。 */
    mediaKinds?: AssetPickerMediaKind[];
    open: boolean;
    items: AssetLibraryPickerItem[];
    categoryLabels: Record<string, string>;
    initialCategory?: string;
    initialFolderId?: string;
    folders?: AssetLibraryPickerFolder[];
    initialSelectedIds?: Iterable<string>;
    multiple?: boolean;
    title?: string;
    eyebrow?: string;
    confirmLabel?: (count: number) => string;
    emptyTitle?: string;
    emptyDescription?: string;
    footerNote?: string;
    loading?: boolean;
    pagination?: { current: number; pageSize: number; total: number; onChange: (page: number, pageSize: number) => void };
    folderActionLabel?: string;
    folderActionSource?: "local" | "all";
    upload?: {
        accept: string;
        description: string;
        onUpload: (files: FileList) => Promise<string[]>;
        external?: {
            accept: string;
            description: string;
            onUpload: (files: FileList, folderId?: string) => Promise<AssetLibraryPickerItem[]>;
        };
    };
    onClose: () => void;
    onConfirm: (ids: string[]) => Promise<void> | void;
    onFolderAction?: (folderId: string) => Promise<void> | void;
};

export function AssetLibraryPickerModal({
    remoteLibrary = false,
    remoteKind,
    mediaKinds = DEFAULT_MEDIA_KINDS,
    open,
    items,
    categoryLabels,
    initialCategory = "all",
    initialFolderId = "all",
    folders = [],
    initialSelectedIds,
    multiple = true,
    title,
    eyebrow,
    confirmLabel,
    emptyTitle,
    emptyDescription,
    footerNote,
    loading = false,
    pagination,
    folderActionLabel,
    folderActionSource = "all",
    upload,
    onClose,
    onConfirm,
    onFolderAction,
}: Props) {
    const { locale, text } = useLocaleText();
    const displayTitle = title ?? text("素材库", "Asset library");
    const displayEyebrow = eyebrow ?? text("参考内容", "Reference content");
    const displayEmptyTitle = emptyTitle ?? text("这个分类还没有素材", "No assets in this category");
    const displayEmptyDescription = emptyDescription ?? text("换个分类后再试。", "Try another category.");
    const displayFolderActionLabel = folderActionLabel ?? text("将文件夹放到画布", "Add folder to canvas");
    const displayConfirmLabel = confirmLabel ?? ((count: number) => locale === "en-US" ? `Use selected assets${count ? ` (${count})` : ""}` : `使用已选素材${count ? `（${count}）` : ""}`);
    const { message } = App.useApp();
    const [category, setCategory] = useState(initialCategory);
    const [mediaKind, setMediaKind] = useState<AssetPickerMediaKind | "all">("all");
    const [folderId, setFolderId] = useState(initialFolderId);
    const [source, setSource] = useState<"local" | "plugin">("local");
    const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [uploadedItems, setUploadedItems] = useState<AssetLibraryPickerItem[]>([]);
    const [working, setWorking] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [error, setError] = useState("");
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const [remotePage, setRemotePage] = useState(1);
    const [remotePageSize, setRemotePageSize] = useState(40);
    const [remoteKeyword, setRemoteKeyword] = useState("");
    const remoteEnabled = remoteLibrary && Boolean(userId) && source === "local";
    useEffect(() => {
        const timer = window.setTimeout(() => setRemoteKeyword(keyword.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    useEffect(() => setRemotePage(1), [category, mediaKind, remoteKeyword, open]);
    // remoteKind 是调用方写死的能力约束；媒体类型筛选只在没有该约束时参与服务端查询。
    const remoteQueryKind = remoteKind || (mediaKind === "all" ? undefined : mediaKind);
    const remoteQuery = useQuery({
        queryKey: ["asset-picker", userId, remotePage, remotePageSize, category, remoteKeyword, remoteQueryKind],
        queryFn: ({ signal }) => loadAssetLibraryPage({ page: remotePage, pageSize: remotePageSize, kind: remoteQueryKind, category: category === "all" || category === "archived" || category === remoteQueryKind ? undefined : category, status: category === "archived" ? "archived" : "active", query: remoteKeyword, signal }),
        enabled: remoteEnabled && open && sessionHydrated,
    });
    const remoteItems = useMemo<AssetLibraryPickerItem[]>(() => (remoteQuery.data?.assets || []).filter((asset) => asset.kind !== "entity" && asset.kind !== "model").map((asset) => ({
        id: asset.id, title: asset.title, category: asset.category || "other", archived: asset.status === "archived", asset,
        searchText: (asset.tags ?? []).join(" "),
        ...(items.find((item) => item.id === asset.id) || { disabledReason: text("此素材不适用于当前操作", "This asset is not available for this action") }),
        kindLabel: asset.kind === "image" ? text("图片", "Image") : asset.kind === "video" ? text("视频", "Video") : asset.kind === "audio" ? text("音频", "Audio") : text("文本", "Text"),
    })), [remoteQuery.data, items, locale]);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const initialSelectedIdsRef = useRef(initialSelectedIds);
    const itemsRef = useRef(items);
    initialSelectedIdsRef.current = initialSelectedIds;
    const allItems = useMemo(() => {
        const known = new Set(items.map((item) => item.id));
        return [...items, ...uploadedItems.filter((item) => !known.has(item.id))];
    }, [items, uploadedItems]);
    itemsRef.current = allItems;
    const localItems = useMemo(() => allItems.filter((item) => !item.external), [allItems]);
    // 远端成功且有可展示素材时用远端。真正的空结果保持空列表。
    // 仅在远端空而本地仍有素材、或远端总数>0 但本页全被排除时回退本地，避免合法空搜索被缓存铺满。
    const remoteTotal = remoteQuery.data?.total ?? 0;
    const remoteReady = remoteEnabled && remoteQuery.isSuccess;
    const preferLocalUnsynced = remoteReady && remoteTotal === 0 && localItems.length > 0;
    const remoteEntityOnlyPage = remoteReady && remoteItems.length === 0 && remoteTotal > 0;
    const useRemoteItems = remoteReady && !preferLocalUnsynced && !remoteEntityOnlyPage && (remoteItems.length > 0 || remoteTotal === 0);
    const effectivePagination = useRemoteItems ? { current: remotePage, pageSize: remotePageSize, total: remoteTotal, onChange: (page: number, pageSize: number) => { setRemotePage(page); setRemotePageSize(pageSize); } } : pagination;
    const pluginItems = useMemo(() => allItems.filter((item) => Boolean(item.external)), [allItems]);
    const hasPluginSource = useMemo(() => Object.keys(categoryLabels).some((value) => value.startsWith("external:")) || pluginItems.some((item) => item.category.startsWith("external:")), [categoryLabels, pluginItems]);
    // 媒体类型在分类之前收窄数据源，让左侧分类计数、网格和分页始终描述同一批素材。
    const sourceItems = useMemo(() => {
        const base = source === "plugin" ? pluginItems : useRemoteItems ? remoteItems : localItems;
        if (mediaKind === "all") return base;
        return base.filter((item) => pickerItemMediaKind(item) === mediaKind);
    }, [localItems, mediaKind, pluginItems, useRemoteItems, remoteItems, source]);
    const activeSourceItems = useMemo(() => sourceItems.filter((item) => !item.archived), [sourceItems]);
    const archivedItems = useMemo(() => sourceItems.filter((item) => item.archived), [sourceItems]);
    const mediaKindOptions = useMemo(() => (remoteKind ? [] : Array.from(new Set(mediaKinds))), [mediaKinds, remoteKind]);
    const sourceFolders = source === "plugin" ? folders : [];
    const showCategories = source === "local" || !sourceFolders.length;
    const normalCategories = useMemo(() => useRemoteItems ? Object.keys(categoryLabels).filter((value) => value !== "archived" && !value.startsWith("external:")) : ["all", ...Array.from(new Set(activeSourceItems.map((item) => item.category || "other"))).filter((value) => value !== "all")], [activeSourceItems, categoryLabels, useRemoteItems]);
    const archivedCount = archivedItems.length;
    const isRecycleBin = category === "archived";

    const visibleItems = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return sourceItems.filter((item) => {
            if (category === "archived") {
                if (!item.archived) return false;
            } else if (item.archived || (category !== "all" && item.category !== category)) {
                return false;
            }
            if (folderId !== "all" && (item.folderId || "") !== folderId) return false;
            return useRemoteItems || !query || [item.title, item.searchText || "", item.description || ""].join(" ").toLowerCase().includes(query);
        });
    }, [category, folderId, keyword, sourceItems, useRemoteItems]);
    const selectedIds = useMemo(
        () =>
            Array.from(selected).filter((id) => {
                const item = allItems.find((entry) => entry.id === id);
                return !item?.disabledReason;
            }),
        [allItems, selected],
    );
    const archivedSelectedIds = useMemo(() => selectedIds.filter((id) => allItems.find((item) => item.id === id)?.archived), [allItems, selectedIds]);

    useEffect(() => {
        if (!open) return;

        setFolderId(initialFolderId);
        setCategory(initialCategory);
        setMediaKind("all");
        setSource("local");
        setKeyword("");
        setUploadedItems([]);
        const selectableIds = new Set(itemsRef.current.filter((item) => !item.disabledReason).map((item) => item.id));
        setSelected(new Set(Array.from(initialSelectedIdsRef.current || []).filter((id) => selectableIds.has(id))));
        setWorking(false);
        setUploadingCount(0);
        setError("");
    }, [initialCategory, initialFolderId, open]);

    useEffect(() => {
        if (category === "all" || category === "archived" || normalCategories.includes(category)) return;
        setCategory("all");
    }, [normalCategories, category]);

    useEffect(() => {
        if (hasPluginSource || source === "local") return;
        setSource("local");
    }, [hasPluginSource, source]);

    useEffect(() => {
        if (mediaKind === "all" || mediaKindOptions.includes(mediaKind)) return;
        setMediaKind("all");
    }, [mediaKind, mediaKindOptions]);

    const selectSource = (nextSource: "local" | "plugin") => {
        if (nextSource === "plugin" && !hasPluginSource) return;
        setSource(nextSource);
        setCategory("all");
        setFolderId("all");
        setError("");
    };

    const toggle = (item: AssetLibraryPickerItem) => {
        if (item.disabledReason || working) return;
        setError("");
        setSelected((current) => {
            if (!multiple) return current.has(item.id) ? new Set() : new Set([item.id]);
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
        });
    };

    const confirm = async () => {
        if (!selectedIds.length || working) return;
        setWorking(true);
        setError("");
        try {
            await onConfirm(selectedIds);
        } catch (reason) {
            setError(localizedErrorMessage(reason, "素材操作失败，请重试", "Asset action failed. Try again.", locale));
        } finally {
            setWorking(false);
        }
    };

    const handleRestoreSelected = async () => {
        if (!archivedSelectedIds.length) return;
        setWorking(true);
        try {
            for (const id of archivedSelectedIds) {
                useAssetStore.getState().updateAsset(id, { status: "confirmed" });
            }
            await flushAssetStorePersistence();
        } catch (error) {
            message.error(localizedErrorMessage(error, "素材还原失败", "Could not restore assets", locale));
            setWorking(false);
            return;
        }
        try {
            await saveRemoteUserDataNow();
            setSelected(new Set());
            message.success(locale === "en-US" ? `Restored ${archivedSelectedIds.length} assets to the library` : `已还原 ${archivedSelectedIds.length} 个素材至素材库`);
            setCategory("all");
        } catch (error) {
            const warning = localSavedRemotePendingMessage("已在本地还原", error);
            message.warning(locale === "en-US" ? "Assets restored locally. Cloud sync is pending; check sync status." : warning);
        } finally {
            setWorking(false);
            if (remoteEnabled) void remoteQuery.refetch();
        }
    };

    const handleDeleteSelected = async () => {
        if (!archivedSelectedIds.length) return;
        setWorking(true);
        try {
            await deleteAssetsWithRemoteSync(archivedSelectedIds);
            setSelected(new Set());
            message.success(locale === "en-US" ? `Permanently deleted ${archivedSelectedIds.length} assets` : `已彻底删除 ${archivedSelectedIds.length} 个素材`);
        } catch (err) {
            message.error(localizedErrorMessage(err, "删除失败", "Could not delete assets", locale));
        } finally {
            setWorking(false);
        }
    };

    const handleEmptyRecycleBin = async () => {
        const toDelete = archivedItems;
        if (!toDelete.length) return;
        setWorking(true);
        try {
            await deleteAssetsWithRemoteSync(toDelete.map((item) => item.id));
            setSelected(new Set());
            message.success(locale === "en-US" ? `Deleted ${toDelete.length} assets from ${remoteEnabled ? "this page" : "the trash"}` : `已删除${remoteEnabled ? "当前页" : "回收站"} ${toDelete.length} 个素材`);
            setCategory("all");
        } catch (err) {
            message.error(localizedErrorMessage(err, "清空回收站失败", "Could not empty trash", locale));
        } finally {
            setWorking(false);
        }
    };

    const handleUpload = async (files: FileList | null) => {
        if (!files?.length || working || (source === "local" && !upload) || (source === "plugin" && !upload?.external)) return;
        setWorking(true);
        setError("");
        setUploadingCount(files.length);
        try {
            if (source === "plugin") {
                const uploaded = await upload!.external!.onUpload(files, folderId === "all" ? undefined : folderId);
                setUploadedItems((current) => [...current, ...uploaded]);
                const ids = uploaded.map((item) => item.id);
                if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
            } else {
                const ids = await upload!.onUpload(files);
                if (ids.length) setSelected((current) => new Set(multiple ? [...current, ...ids] : ids.slice(-1)));
            }
        } catch (reason) {
            setError(localizedErrorMessage(reason, "素材上传失败，请重试", "Asset upload failed. Try again.", locale));
        } finally {
            if (uploadInputRef.current) uploadInputRef.current.value = "";
            setWorking(false);
            setUploadingCount(0);
        }
    };

    const runFolderAction = async () => {
        if (!onFolderAction || folderId === "all" || working) return;
        setWorking(true);
        setError("");
        try {
            await onFolderAction(folderId);
        } catch (reason) {
            setError(localizedErrorMessage(reason, "文件夹操作失败，请重试", "Folder action failed. Try again.", locale));
        } finally {
            setWorking(false);
        }
    };

    const countFor = (value: string) => (value === "all" ? activeSourceItems.length : activeSourceItems.filter((item) => item.category === value).length);
    const sourceLabel = source === "plugin" ? text("插件来源", "Plugin source") : text("本地素材", "Local assets");
    const sourceMenuItems: MenuProps["items"] = [
        {
            key: "local",
            icon: <HardDrive aria-hidden="true" />,
            label: (
                <span className="asset-picker-source-menu-label">
                    <span>{text("本地素材", "Local assets")}</span>
                    <em>{localItems.filter((item) => !item.archived).length}</em>
                </span>
            ),
        },
        ...(hasPluginSource
            ? [
                  {
                      key: "plugin",
                      icon: <Puzzle aria-hidden="true" />,
                      label: (
                          <span className="asset-picker-source-menu-label">
                              <span>{text("插件来源", "Plugin source")}</span>
                              <em>{pluginItems.length}</em>
                          </span>
                      ),
                  },
              ]
            : []),
    ];
    const activeUpload = isRecycleBin ? undefined : source === "plugin" ? upload?.external : upload;
    const uploading = uploadingCount > 0;

    return (
        <AppModal
            centered
            open={open}
            footer={null}
            title={null}
            destroyOnHidden
            closable={!working}
            mask={{ closable: !working }}
            keyboard={!working}
            onCancel={() => {
                if (!working) onClose();
            }}
            className="workspace-modal workspace-modal-wide asset-library-picker-modal"
            flush
        >
            <div className="asset-picker-shell">
                <header className="asset-picker-toolbar">
                    <div className="asset-picker-heading">
                        <div className="asset-picker-heading-copy">
                            <span>{displayEyebrow}</span>
                            <Dropdown
                                trigger={["click"]}
                                placement="bottomLeft"
                                rootClassName="asset-picker-source-dropdown"
                                onOpenChange={setSourceMenuOpen}
                                menu={{
                                    selectedKeys: [source],
                                    items: sourceMenuItems,
                                    onClick: ({ key }) => {
                                        if (key === "local" || key === "plugin") selectSource(key);
                                    },
                                }}
                            >
                                <button type="button" className="asset-picker-title-trigger" aria-haspopup="menu" aria-expanded={sourceMenuOpen} aria-label={`${text("素材库来源", "Asset source")}: ${sourceLabel}`}>
                                    <strong>{isRecycleBin ? text("回收站", "Trash") : displayTitle}</strong>
                                    <ChevronDown aria-hidden="true" />
                                </button>
                            </Dropdown>
                        </div>
                    </div>
                    <label className="asset-picker-search">
                        <Search aria-hidden />
                        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={text("搜索素材名称或标签", "Search asset names or tags")} aria-label={text("搜索素材", "Search assets")} />
                    </label>
                    <span className="asset-picker-count">
                        {locale === "en-US" ? `${selectedIds.length} selected · ${effectivePagination ? effectivePagination.total : visibleItems.length} assets` : `已选 ${selectedIds.length} · ${effectivePagination ? effectivePagination.total : visibleItems.length} 个素材`}
                    </span>
                </header>
                <div className="asset-picker-body">
                    <nav className="asset-picker-categories" aria-label={text("素材分类", "Asset categories")}>
                        {mediaKindOptions.length > 1 && !isRecycleBin ? (
                            <>
                                <span className="asset-picker-nav-label">{text("媒体类型", "Media type")}</span>
                                {(["all", ...mediaKindOptions] as const).map((value) => (
                                    <button key={value} type="button" className={cn("assets-filter-item", mediaKind === value && "is-active")} aria-pressed={mediaKind === value} onClick={() => setMediaKind(value)}>
                                        <span className="assets-filter-item-label">{value === "all" ? text("全部类型", "All types") : locale === "en-US" ? { image: "Images", video: "Video", audio: "Audio", text: "Text" }[value] : ASSET_PICKER_MEDIA_KIND_LABELS[value]}</span>
                                    </button>
                                ))}
                            </>
                        ) : null}
                        {sourceFolders.length ? (
                            <>
                                <span className="asset-picker-nav-label">{text("文件夹", "Folders")}</span>
                                <button type="button" className={cn("assets-filter-item", folderId === "all" && "is-active")} aria-pressed={folderId === "all"} onClick={() => setFolderId("all")}>
                                    <span className="assets-filter-item-label">{text("全部文件夹", "All folders")}</span>
                                    <span className="assets-filter-count">{sourceItems.length}</span>
                                </button>
                                {renderPickerFolders(sourceFolders, activeSourceItems, folderId, setFolderId)}
                            </>
                        ) : null}
                        {showCategories ? (
                            <>
                                <span className="asset-picker-nav-label">{text("分类", "Categories")}</span>
                                {normalCategories.map((value) => (
                                    <button key={value} type="button" className={cn("assets-filter-item", category === value && "is-active")} aria-pressed={category === value} onClick={() => setCategory(value)}>
                                        <span className="assets-filter-item-label">{value === "all" ? text("全部素材", "All assets") : (ASSET_CATEGORIES as readonly string[]).includes(value) ? assetCategoryLabel(value, locale) : categoryLabels[value] || text("其他", "Other")}</span>
                                        <span className="assets-filter-count">{countFor(value)}</span>
                                    </button>
                                ))}
                                {archivedCount > 0 || remoteEnabled ? (
                                    <div className="mt-3 border-t border-border/40 pt-2">
                                        <button
                                            type="button"
                                            className={cn("assets-filter-item text-amber-500 hover:text-amber-400 dark:text-amber-400", category === "archived" && "is-active !bg-amber-500/10")}
                                            aria-pressed={category === "archived"}
                                            onClick={() => setCategory("archived")}
                                        >
                                            <span className="assets-filter-item-label flex items-center gap-1.5">
                                                <Trash2 className="size-3.5" />
                                                <span>{text("回收站", "Trash")}</span>
                                            </span>
                                            <span className="assets-filter-count">{archivedCount}</span>
                                        </button>
                                    </div>
                                ) : null}
                            </>
                        ) : null}
                    </nav>
                    <div className="asset-picker-grid-wrap">
                        <div className="asset-picker-grid">
                            {remoteEnabled && remoteQuery.isError && !localItems.length ? <div className="asset-picker-empty" role="alert"><FolderOpen /><strong>{text("素材读取失败", "Could not load assets")}</strong><span>{text("服务端暂时不可用，重试不会影响本地已保存素材。", "The server is unavailable. Retrying will not change locally saved assets.")}</span><Button onClick={() => void remoteQuery.refetch()}>{text("重试", "Retry")}</Button></div> : loading || (useRemoteItems && remoteQuery.isFetching) ? (
                                <div className="asset-picker-empty">
                                    <LoaderCircle className="animate-spin" />
                                    <strong>{text("正在读取素材", "Loading assets")}</strong>
                                    <span>{text("素材会按页加载，不会一次下载整个项目库。", "Assets load one page at a time.")}</span>
                                </div>
                            ) : visibleItems.length ? (
                                visibleItems.map((item) => <PickerCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={() => toggle(item)} />)
                            ) : (
                                <div className="asset-picker-empty">
                                    <FolderOpen />
                                    <strong>{isRecycleBin ? text("回收站是空的", "Trash is empty") : displayEmptyTitle}</strong>
                                    <span>{isRecycleBin ? text("删除画布或手动归档的素材会暂存到这里，可在需要时还原。", "Archived assets stay here until restored or permanently deleted.") : activeUpload ? text("换个分类，或从底部上传一份新素材。", "Try another category or upload an asset below.") : displayEmptyDescription}</span>
                                </div>
                            )}
                        </div>
                        {effectivePagination ? <PaginationBar alwaysShow current={effectivePagination.current} pageSize={effectivePagination.pageSize} total={effectivePagination.total} itemLabel={text("项", "assets")} pageSizeOptions={[20, 40, 80]} onChange={effectivePagination.onChange} /> : null}
                    </div>
                </div>
                <footer className={cn("asset-picker-footer", !activeUpload && "is-compact")}>
                    {activeUpload ? (
                        <>
                            <input ref={uploadInputRef} type="file" hidden accept={activeUpload.accept} multiple={multiple} onChange={(event) => void handleUpload(event.target.files)} />
                            <button type="button" className="asset-picker-upload" onClick={() => uploadInputRef.current?.click()} disabled={working} aria-busy={uploading}>
                                {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                                <span>
                                    <strong>{uploading ? locale === "en-US" ? `Uploading ${uploadingCount} assets` : `正在上传 ${uploadingCount} 个素材` : text("上传新素材", "Upload assets")}</strong>
                                    <small>{uploading ? text("保存完成后会自动选中", "Uploaded assets will be selected") : activeUpload.description}</small>
                                </span>
                            </button>
                        </>
                    ) : footerNote || (remoteEnabled && remoteQuery.isError) ? (
                        <span className="asset-picker-footer-note">{remoteEnabled && remoteQuery.isError ? text("云端素材暂时不可用，当前显示本地缓存", "Cloud assets are unavailable; showing local cache") : footerNote}</span>
                    ) : (
                        <span />
                    )}
                    {error ? (
                        <span className="asset-picker-footer-error" role="alert">
                            {error}
                        </span>
                    ) : null}
                    <div className="asset-picker-actions">
                        {isRecycleBin ? (
                            <>
                                <Popconfirm title={remoteEnabled ? text("确认删除当前页回收站素材？", "Delete trashed assets on this page?") : text("确认清空回收站？", "Empty the trash?")} description={text("仅删除当前列表中的素材；关联文件会直接释放，原画布或任务中的旧引用可能失效。删除不可恢复。", "Files linked to these assets will be released. Existing canvas or task references may stop working. This cannot be undone.")} onConfirm={handleEmptyRecycleBin} okText={text("删除", "Delete")} okButtonProps={{ danger: true }} cancelText={text("取消", "Cancel")}>
                                    <Button type="text" danger disabled={working || !archivedCount}>
                                        {remoteEnabled ? text("删除当前页", "Delete this page") : text("清空回收站", "Empty trash")}
                                    </Button>
                                </Popconfirm>
                                <Popconfirm title={text("确认彻底删除已选素材？", "Permanently delete selected assets?")} onConfirm={handleDeleteSelected} okText={text("删除", "Delete")} okButtonProps={{ danger: true }} cancelText={text("取消", "Cancel")}>
                                    <Button type="text" danger disabled={working || !archivedSelectedIds.length}>
                                        {text("彻底删除", "Delete permanently")}
                                    </Button>
                                </Popconfirm>
                                <Button type="text" onClick={onClose} disabled={working}>
                                    {text("关闭", "Close")}
                                </Button>
                                <Button type="primary" icon={<RotateCcw className="size-3.5" />} disabled={working || !archivedSelectedIds.length} loading={working} onClick={handleRestoreSelected}>
                                    {text("还原已选素材", "Restore selected")}{archivedSelectedIds.length ? locale === "en-US" ? ` (${archivedSelectedIds.length})` : `（${archivedSelectedIds.length}）` : ""}
                                </Button>
                            </>
                        ) : (
                            <>
                                {onFolderAction && folderId !== "all" && (folderActionSource !== "local" || source === "local") ? (
                                    <Button type="text" icon={<FolderOpen />} disabled={working} onClick={() => void runFolderAction()}>
                                        {displayFolderActionLabel}
                                    </Button>
                                ) : null}
                                <Button type="text" onClick={onClose} disabled={working}>
                                    {text("取消", "Cancel")}
                                </Button>
                                <Button type="primary" icon={<Check />} disabled={working || !selectedIds.length} loading={working && !uploading} onClick={() => void confirm()}>
                                    {displayConfirmLabel(selectedIds.length)}
                                </Button>
                            </>
                        )}
                    </div>
                </footer>
            </div>
        </AppModal>
    );
}

// 角色卡、3D 模型等非媒体条目没有媒体类型，媒体筛选生效时不参与匹配。
export function pickerItemMediaKind(item: AssetLibraryPickerItem): AssetPickerMediaKind | undefined {
    if (item.mediaKind) return item.mediaKind;
    const kind = item.external?.item.kind || item.asset?.kind;
    return kind === "image" || kind === "video" || kind === "audio" || kind === "text" ? kind : undefined;
}

function PickerCard({ item, selected, onToggle }: { item: AssetLibraryPickerItem; selected: boolean; onToggle: () => void }) {
    const { text } = useLocaleText();
    const disabled = Boolean(item.disabledReason);
    return (
        <AssetLibraryCard selected={selected} className={cn("asset-picker-card", disabled && "is-disabled")}>
            <button type="button" className="asset-picker-card-action" onClick={onToggle} disabled={disabled} aria-pressed={selected} title={item.disabledReason || item.title}>
                <div className="assets-cover asset-picker-card-media">
                    {item.imageUrl || item.imageStorageKey ? (
                        <CachedResourceImage
                            storageKey={item.imageStorageKey}
                            src={item.imageUrl}
                            alt={item.title}
                            loading="lazy"
                            decoding="async"
                            className={item.imageFit === "contain" ? "is-contain" : undefined}
                            fallback={<div className="assets-cover-fallback">{kindIcon(item)}</div>}
                        />
                    ) : (
                        <AssetMediaPreview asset={item.asset} alt={item.title} fallback={<div className="assets-cover-fallback">{kindIcon(item)}</div>} />
                    )}
                    <span className="assets-cover-vignette" aria-hidden="true" />
                    <span className="assets-cover-badges" aria-hidden="true">
                        <span className="assets-cover-badge is-kind">{item.kindLabel}</span>
                    </span>
                    <span className="asset-picker-card-check" aria-hidden="true">
                        <Check />
                    </span>
                    {item.disabledReason ? <span className="asset-picker-card-lock">{item.disabledReason}</span> : null}
                </div>
                <div className="asset-picker-card-copy">
                    <strong>{item.title || text("未命名素材", "Untitled asset")}</strong>
                    {item.description ? <span>{item.description}</span> : null}
                </div>
            </button>
        </AssetLibraryCard>
    );
}

function renderPickerFolders(folders: AssetLibraryPickerFolder[], items: AssetLibraryPickerItem[], selectedId: string, onSelect: (folderId: string) => void, parentId = "", depth = 0, visited: ReadonlySet<string> = new Set()): ReactNode {
    if (depth >= 8) return null;
    return folders
        .filter((folder) => (folder.parentId || "") === parentId && !visited.has(folder.id))
        .map((folder) => {
            const nextVisited = new Set(visited).add(folder.id);
            return (
                <span key={folder.id} className="contents">
                    <button
                        type="button"
                        className={cn("assets-filter-item", selectedId === folder.id && "is-active")}
                        aria-pressed={selectedId === folder.id}
                        onClick={() => onSelect(folder.id)}
                        style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-3))` }}
                    >
                        <span className="assets-filter-item-label" title={folder.name}>
                            {folder.name}
                        </span>
                        <span className="assets-filter-count">{items.filter((item) => item.folderId === folder.id).length}</span>
                    </button>
                    {renderPickerFolders(folders, items, selectedId, onSelect, folder.id, depth + 1, nextVisited)}
                </span>
            );
        });
}

function kindIcon(item: AssetLibraryPickerItem): ReactNode {
    if (item.asset?.kind === "entity") return <UserRound />;
    if (pickerItemMediaKind(item) === "video") return <Video />;
    if (pickerItemMediaKind(item) === "audio") return <Music2 />;
    if (pickerItemMediaKind(item) === "text") return <FileText />;
    return <ImageIcon />;
}
