import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { assetGridCardMinWidth, assetGridDensityOptions, parseAssetGridDensity, type AssetGridDensity } from "./asset-grid-density";
import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import { AlertTriangle, AudioLines, Box, CheckCheck, Clapperboard, Copy, Download, FileText, FileUp, FolderOpen, FolderPlus, Image as ImageIcon, Images, LayoutGrid, Link2, Maximize2, MoreHorizontal, PencilLine, Play, Plus, RotateCcw, Search, Trash2, Upload, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Dropdown, Form, Input, Modal, Popconfirm, Progress, Space, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import { useNavigate } from "react-router";

import { CollectionGrid, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { Switch } from "@/components/ui/base/switch";
import { cn } from "@/lib/utils";

import { useCopyText } from "@/hooks/use-copy-text";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ASSET_CATEGORY_OPTIONS, assetCategoryLabel } from "@/lib/asset-category";
import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { formatBytes, readFileAsDataUrl, readImageMeta } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { downloadBrowserMedia } from "@/services/browser-download";
import { flushAssetStorePersistence, useAssetStore, type Asset, type AssetCategory, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { AssetStorageUsage, assetStorageUsageQueryKey } from "./asset-storage-usage";
import { deleteAssetWithRemoteSync, deleteAssetsWithRemoteSync, loadAssetLibraryPage, loadAssetsForUse, localSavedRemotePendingMessage, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useUserStore } from "@/stores/use-user-store";
import { createAssetFolder, deleteAssetFolder, listAssetFolders, listRemoteAssetsPage, moveRemoteAssetsToFolder, updateAssetFolder, type AssetFolder } from "@/services/api/user-data";
import { AssetBatchUploadModal } from "./asset-batch-upload-modal";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { Select } from "@/components/ui/base/select";
import { localizedErrorMessage, useLocaleText, type AppLocale } from "@/lib/i18n";
import { ApiError } from "@/services/api/request";

type LibraryAsset = Exclude<Asset, { kind: "entity" }>;

type AssetFormValues = {
    kind: AssetKind;
    category: AssetCategory;
    folderId?: string;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
    arkAssetId?: string;
    portraitCertified?: boolean;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
    { label: "3D 模型", value: "model" },
];

const categoryOptions = [{ label: "全部分类", value: "all" }, ...ASSET_CATEGORY_OPTIONS];
const ASSET_LIBRARY_QUERY_KEY = ["asset-library"] as const;
const ASSET_FOLDER_QUERY_KEY = ["asset-folders"] as const;
const ASSET_GRID_DENSITY_KEY = "infinite-canvas:asset-grid-density";
type AssetFolderFilter = "all" | "uncategorized" | string;

const assetKindIcons: Record<LibraryAsset["kind"], LucideIcon> = {
    text: FileText,
    image: ImageIcon,
    video: Clapperboard,
    audio: AudioLines,
    model: Box,
};

export default function AssetsPage() {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);

    const updateAsset = useAssetStore((state) => state.updateAsset);
    const userId = useUserStore((state) => state.user?.id || "");
    const pluginCenterEnabled = useUserStore((state) => state.features.pluginCenterEnabled);
    const retentionDays = useUserStore((state) => state.runtimeLimits.recycleBinRetentionDays ?? 30);
    const [viewMode, setViewMode] = useState<"library" | "trash">("library");
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [categoryFilter, setCategoryFilter] = useState<AssetCategory | "all">("all");
    const [folderFilter, setFolderFilter] = useState<AssetFolderFilter>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(40);
    const [gridDensity, setGridDensity] = useState<AssetGridDensity>(readAssetGridDensity);
    const [editingAsset, setEditingAsset] = useState<LibraryAsset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<LibraryAsset | null>(null);
    const [archivingAsset, setArchivingAsset] = useState<LibraryAsset | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
    const [batchArchiveOpen, setBatchArchiveOpen] = useState(false);
    const [batchUploadOpen, setBatchUploadOpen] = useState(false);
    const [folderEditor, setFolderEditor] = useState<AssetFolder | "new" | null>(null);
    const [folderName, setFolderName] = useState("");
    const [folderSaving, setFolderSaving] = useState(false);

    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUploading, setImageUploading] = useState(false);
    const [imageUploadProgress, setImageUploadProgress] = useState<{ phase: "uploading" | "confirming"; percent?: number } | null>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);

    const foldersQuery = useQuery({
        queryKey: ASSET_FOLDER_QUERY_KEY,
        queryFn: () => listAssetFolders(),
        enabled: Boolean(userId),
    });
    const folders = foldersQuery.data?.folders || [];

    const allLibraryAssets = useMemo(() => assets.filter((asset): asset is LibraryAsset => asset.kind !== "entity"), [assets]);
    const activeAssets = useMemo(() => allLibraryAssets.filter((asset) => asset.status !== "archived"), [allLibraryAssets]);
    const trashAssets = useMemo(() => allLibraryAssets.filter((asset) => asset.status === "archived"), [allLibraryAssets]);
    const validAssets = viewMode === "trash" ? trashAssets : activeAssets;
    const selectedAssets = useMemo(() => validAssets.filter((asset) => selectedIds.includes(asset.id)), [selectedIds, validAssets]);
    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (categoryFilter !== "all" && (asset.category || "other") !== categoryFilter) return false;
            if (folderFilter === "uncategorized" && asset.folderId) return false;
            if (folderFilter !== "all" && folderFilter !== "uncategorized" && asset.folderId !== folderFilter) return false;
            if (!query) return true;
            return assetSearchText(asset, locale).includes(query);
        });
    }, [validAssets, keyword, kindFilter, categoryFilter, folderFilter, locale]);

    const assetPageQuery = useQuery({
        queryKey: [...ASSET_LIBRARY_QUERY_KEY, page, pageSize, viewMode, kindFilter, categoryFilter, folderFilter, debouncedKeyword],
        queryFn: ({ signal }) => loadAssetLibraryPage({
            page,
            pageSize,
            status: viewMode === "trash" ? "archived" : "active",
            kind: kindFilter === "all" ? undefined : kindFilter,
            category: categoryFilter === "all" ? undefined : categoryFilter,
            folderId: folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : undefined,
            uncategorized: folderFilter === "uncategorized",
            query: debouncedKeyword || undefined,
            signal,
        }),
        enabled: Boolean(userId),
        placeholderData: keepPreviousData,
    });

    const localVisibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);
    // 远端成功且本页有可展示素材时用远端。真正的空结果保持空页。
    // 仅在「远端空、本地仍有筛选结果」或「远端总数>0 但本页全是被排除的 entity」时回退本地。
    const remotePageAssets = useMemo(() => (assetPageQuery.data?.assets || []).filter((asset): asset is LibraryAsset => asset.kind !== "entity"), [assetPageQuery.data?.assets]);
    const remoteTotal = assetPageQuery.data?.total ?? 0;
    const remoteReady = assetPageQuery.isSuccess && assetPageQuery.data !== undefined;
    const preferLocalUnsynced = remoteReady && remoteTotal === 0 && localVisibleAssets.length > 0;
    const remoteEntityOnlyPage = remoteReady && remotePageAssets.length === 0 && remoteTotal > 0;
    const useRemotePage = remoteReady && !preferLocalUnsynced && !remoteEntityOnlyPage && (remotePageAssets.length > 0 || remoteTotal === 0);
    const visibleAssets = useMemo(() => useRemotePage ? remotePageAssets : localVisibleAssets, [useRemotePage, remotePageAssets, localVisibleAssets]);
    const visibleAssetIds = useMemo(() => visibleAssets.map((asset) => asset.id), [visibleAssets]);
    const allFilteredSelected = visibleAssetIds.length > 0 && visibleAssetIds.every((id) => selectedIds.includes(id));
    const totalAssets = useRemotePage ? remoteTotal : filteredAssets.length;
    const kindCounts = useMemo(() => assetCountMap(kindOptions, useRemotePage ? assetPageQuery.data?.kindCounts : undefined, viewMode === "trash" ? trashAssets : activeAssets, (asset) => asset.kind), [activeAssets, assetPageQuery.data?.kindCounts, trashAssets, useRemotePage, viewMode]);
    const categoryCounts = useMemo(() => assetCountMap(categoryOptions, useRemotePage ? assetPageQuery.data?.categoryCounts : undefined, viewMode === "trash" ? trashAssets : activeAssets, (asset) => asset.category || "other"), [activeAssets, assetPageQuery.data?.categoryCounts, trashAssets, useRemotePage, viewMode]);
    const folderCounts = assetPageQuery.data?.folderCounts || {};

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(totalAssets / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [pageSize, totalAssets]);

    useEffect(() => {
        window.localStorage.setItem(ASSET_GRID_DENSITY_KEY, String(gridDensity));
    }, [gridDensity]);

    useEffect(() => {
        const existingIds = new Set(validAssets.map((asset) => asset.id));
        setSelectedIds((current) => current.filter((id) => existingIds.has(id)));
    }, [validAssets]);

    const folderSelectOptions = useMemo(() => [
        { label: text("未分类", "Uncategorized"), value: "" },
        ...folders.map((folder) => ({ label: folder.name, value: folder.id })),
    ], [folders, locale]);

    const pendingSyncWarning = (chineseAction: string, englishAction: string, error: unknown) => {
        const chineseMessage = localSavedRemotePendingMessage(chineseAction, error);
        if (locale !== "en-US") return chineseMessage;
        if (error instanceof ApiError && error.reason === "canvas_history_resources_missing") return `${englishAction} locally. Cloud sync is paused; repair the missing assets or restore a valid version.`;
        if (error instanceof ApiError && (error.status === 409 || error.status === 428)) return `${englishAction} locally. Cloud sync is paused; keep your draft and load the latest version.`;
        return `${englishAction} locally. Cloud sync failed and will retry automatically.`;
    };

    const invalidateAssetLibrary = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ASSET_LIBRARY_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: ASSET_FOLDER_QUERY_KEY }),
        ]);
    };

    const saveFolder = async () => {
        const name = folderName.trim();
        if (!name || !folderEditor) return;
        setFolderSaving(true);
        try {
            if (folderEditor === "new") await createAssetFolder(name);
            else await updateAssetFolder(folderEditor.id, name);
            setFolderEditor(null);
            setFolderName("");
            await invalidateAssetLibrary();
            message.success(folderEditor === "new" ? text("素材分类已创建", "Folder created") : text("素材分类已重命名", "Folder renamed"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "素材分类保存失败", "Could not save folder", locale));
        } finally {
            setFolderSaving(false);
        }
    };

    const removeFolder = async (folder: AssetFolder) => {
        try {
            await deleteAssetFolder(folder.id);
            for (const asset of useAssetStore.getState().assets) {
                if (asset.folderId === folder.id) updateAsset(asset.id, { folderId: undefined });
            }
            await flushAssetStorePersistence();
            if (folderFilter === folder.id) setFolderFilter("all");
            setPage(1);
            await invalidateAssetLibrary();
            message.success(locale === "en-US" ? `Deleted folder "${folder.name}". Its assets are now uncategorized.` : `已删除分类「${folder.name}」，其中素材已移至未分类`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "素材分类删除失败", "Could not delete folder", locale));
            throw error;
        }
    };

    const moveAssetsToFolder = async (assetIds: string[], folderId: string) => {
        if (!assetIds.length) return;
        try {
            await moveRemoteAssetsToFolder(assetIds, folderId);
            assetIds.forEach((id) => updateAsset(id, { folderId: folderId || undefined }));
            await flushAssetStorePersistence();
            setSelectedIds([]);
            await invalidateAssetLibrary();
            message.success(locale === "en-US" ? `Moved ${assetIds.length} assets` : `已移动 ${assetIds.length} 个素材`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "移动素材失败", "Could not move assets", locale));
        }
    };

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setImageFile(null);
        setImageUploading(false);
        setImageUploadProgress(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", category: "other", folderId: folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : "", title: "", coverUrl: "", tags: [], source: text("手动添加", "Added manually"), note: "", content: "", arkAssetId: "", portraitCertified: false });
        setIsAssetOpen(true);
    };

    const openEdit = async (asset: LibraryAsset) => {
        let editableAsset = useAssetStore.getState().assets.find((item): item is LibraryAsset => item.id === asset.id && item.kind !== "entity");
        if (!editableAsset) {
            try {
                // 分页卡片是轻量 DTO，编辑前补齐完整记录，避免保存时覆盖远端 metadata。
                await loadAssetsForUse([asset.id]);
                editableAsset = useAssetStore.getState().assets.find((item): item is LibraryAsset => item.id === asset.id && item.kind !== "entity");
            } catch (error) {
                message.error(localizedErrorMessage(error, "素材详情读取失败，请重试", "Could not load asset details. Try again.", locale));
                return;
            }
        }
        if (!editableAsset) {
            message.error(text("素材详情读取失败，请重试", "Could not load asset details. Try again."));
            return;
        }
        setEditingAsset(editableAsset);
        setImageFile(null);
        setImageUploading(false);
        setImageUploadProgress(null);
        setFormKind(editableAsset.kind);
        setImageDraft(editableAsset.kind === "image" ? editableAsset.data : null);
        form.setFieldsValue({
            kind: editableAsset.kind,
            category: editableAsset.category || "other",
            folderId: editableAsset.folderId || "",
            title: editableAsset.title,
            coverUrl: editableAsset.coverUrl,
            tags: editableAsset.tags || [],
            source: editableAsset.source,
            note: editableAsset.note,
            content: editableAsset.kind === "text" ? editableAsset.data.content : "",
            arkAssetId: editableAsset.arkAssetId || "",
            portraitCertified: editableAsset.portraitCertified === true,
        });
        setIsAssetOpen(true);
    };

    const ensureAssetsInStore = async (assetIds: string[]) => {
        const missingIds = assetIds.filter((id) => !useAssetStore.getState().assets.some((asset) => asset.id === id));
        if (missingIds.length) await loadAssetsForUse(missingIds);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        let imageData = imageDraft;
        if (values.kind === "image" && imageFile) {
            setImageUploading(true);
            setImageUploadProgress({ phase: "uploading", percent: 0 });
            try {
                const image = await uploadImage(imageFile);
                setImageUploadProgress({ phase: "confirming" });
                imageData = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
                setImageDraft(imageData);
                setImageFile(null);
                void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
            } catch (error) {
                message.error(localizedErrorMessage(error, "图片上传失败，请重试", "Could not upload image. Try again.", locale));
                return;
            } finally {
                setImageUploading(false);
                setImageUploadProgress(null);
            }
        }

        const base = {
            title: values.title.trim(),
            category: values.category,
            folderId: values.folderId || undefined,
            status: editingAsset?.status || ("confirmed" as const),
            primaryVersionId: editingAsset?.primaryVersionId,
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageData ? imageData.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            arkAssetId: values.arkAssetId?.trim() || undefined,
            portraitCertified: values.portraitCertified || undefined,
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageData) {
                message.error(text("请选择图片文件", "Choose an image file"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageData };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        try {
            await flushAssetStorePersistence();
        } catch (error) {
            message.error(localizedErrorMessage(error, "素材本地保存失败", "Could not save asset locally", locale));
            return;
        }
        try {
            await saveRemoteUserDataNow();
            await invalidateAssetLibrary();
            message.success(editingAsset ? text("素材已更新", "Asset updated") : text("素材已保存", "Asset saved"));
        } catch (error) {
            message.warning(pendingSyncWarning(editingAsset ? "素材已在本地更新" : "素材已在本地保存", editingAsset ? "Asset updated" : "Asset saved", error));
        }
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/") || imageUploading) return;
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const meta = await readImageMeta(dataUrl);
            setImageFile(file);
            const draft = { dataUrl, storageKey: "", width: meta.width, height: meta.height, bytes: file.size, mimeType: file.type || meta.mimeType };
            setImageDraft(draft);
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", dataUrl);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch (error) {
            message.error(localizedErrorMessage(error, "读取图片失败，请重试", "Could not read image. Try again.", locale));
        }
    };

    const readModelFile = async (file?: File) => {
        if (!file || !/\.(glb|gltf)$/i.test(file.name)) return;
        const uploaded = await uploadMediaFile(file, "model");
        void queryClient.invalidateQueries({ queryKey: assetStorageUsageQueryKey });
        addAsset({
            kind: "model",
            title: file.name.replace(/\.(glb|gltf)$/i, ""),
            coverUrl: "",
            tags: [text("3D模型", "3D model")],
            source: text("手动上传", "Uploaded manually"),
            data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: file.name },
            metadata: { source: "manual" },
        });
        // 直传失败时文件只落在本机，云端同步会重传；此时不能说成"已保存"。
        if (uploaded.pendingRemoteUpload) message.warning(locale === "en-US" ? "3D model saved locally; upload to the server is pending." : `3D 模型已保存在本机，尚未上传到服务器${uploaded.remoteUploadError ? `：${uploaded.remoteUploadError}` : ""}`);
        else message.success(text("3D 模型已保存", "3D model saved"));
    };

    const copyAssetText = async (asset: LibraryAsset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, text("文本已复制", "Text copied"));
    };

    const downloadImage = async (asset: LibraryAsset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return;
        const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const extension = asset.kind === "model" ? asset.data.fileName.split(".").pop() || "glb" : asset.data.mimeType.split("/")[1] || "png";
        try {
            await downloadBrowserMedia({ storageKey: asset.data.storageKey, url, fileName: `${asset.title || "asset"}.${extension}` });
        } catch (error) {
            message.error(localizedErrorMessage(error, "下载失败", "Download failed", locale));
        }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(text("暂无素材可导出", "No assets to export"));
            return;
        }
        await exportAssets(validAssets);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(locale === "en-US" ? `Imported ${importedAssets.length} assets` : `已导入 ${importedAssets.length} 个素材`);
        } catch {
            message.error(text("导入失败，请选择有效的素材压缩包", "Import failed. Choose a valid asset archive."));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const restoreAsset = async (asset: LibraryAsset) => {
        try {
            await ensureAssetsInStore([asset.id]);
            updateAsset(asset.id, { status: "confirmed" });
            await flushAssetStorePersistence();
        } catch (error) {
            message.error(localizedErrorMessage(error, "素材还原失败", "Could not restore asset", locale));
            return;
        }
        try {
            await saveRemoteUserDataNow();
            message.success(locale === "en-US" ? `Restored "${asset.title}"` : `已还原素材「${asset.title}」`);
        } catch (error) {
            message.warning(pendingSyncWarning("已在本地还原", "Asset restored", error));
        }
    };

    const batchRestore = async () => {
        if (!selectedIds.length) return;
        try {
            await ensureAssetsInStore(selectedIds);
            for (const id of selectedIds) updateAsset(id, { status: "confirmed" });
            const count = selectedIds.length;
            await flushAssetStorePersistence();
            setSelectedIds([]);
            try {
                await saveRemoteUserDataNow();
            } catch (error) {
                message.warning(pendingSyncWarning("已在本地还原", "Assets restored", error));
                return;
            }
            message.success(locale === "en-US" ? `Restored ${count} assets` : `已还原 ${count} 个素材`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "批量还原失败", "Could not restore selected assets", locale));
        }
    };

    const archiveAsset = async (asset: LibraryAsset) => {
        try {
            await ensureAssetsInStore([asset.id]);
            updateAsset(asset.id, { status: "archived" });
            await flushAssetStorePersistence();
        } catch (error) {
            message.error(localizedErrorMessage(error, "移入回收站失败", "Could not move asset to trash", locale));
            return;
        }
        try {
            await saveRemoteUserDataNow();
            message.success(locale === "en-US" ? `Moved "${asset.title}" to trash` : `已将「${asset.title}」移入回收站`);
        } catch (error) {
            message.warning(pendingSyncWarning("已移入回收站", "Asset moved to trash", error));
        }
    };

    const batchArchive = async () => {
        if (!selectedIds.length) return;
        try {
            await ensureAssetsInStore(selectedIds);
            for (const id of selectedIds) updateAsset(id, { status: "archived" });
            const count = selectedIds.length;
            await flushAssetStorePersistence();
            setSelectedIds([]);
            try {
                await saveRemoteUserDataNow();
            } catch (error) {
                message.warning(pendingSyncWarning("已移入回收站", "Assets moved to trash", error));
                return;
            }
            message.success(locale === "en-US" ? `Moved ${count} assets to trash` : `已将 ${count} 个素材移入回收站`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "批量移入回收站失败", "Could not move selected assets to trash", locale));
        }
    };

    const emptyTrash = async () => {
        const count = trashAssets.length;
        if (!count) return;
        try {
            await deleteAssetsWithRemoteSync(trashAssets.map((asset) => asset.id));
            setSelectedIds([]);
            message.success(locale === "en-US" ? `Permanently deleted ${count} trashed assets` : `已彻底清空回收站 ${count} 个素材`);
        } catch (error) {
            message.error(localizedErrorMessage(error, "清空回收站失败", "Could not empty trash", locale));
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        try {
            await deleteAssetWithRemoteSync(deletingAsset.id);
            message.success(text("素材已彻底删除", "Asset permanently deleted"));
            setDeletingAsset(null);
        } catch (error) {
            message.error(localizedErrorMessage(error, "素材删除失败", "Could not delete asset", locale));
        }
    };

    const exportSelectedAssets = async () => {
        if (!selectedAssets.length) return;
        await exportAssets(selectedAssets);
    };

    const confirmBatchDelete = async () => {
        if (!selectedAssets.length) return;
        try {
            await deleteAssetsWithRemoteSync(selectedAssets.map((asset) => asset.id));
            message.success(locale === "en-US" ? `Permanently deleted ${selectedAssets.length} assets` : `已彻底删除 ${selectedAssets.length} 个素材`);
            setSelectedIds([]);
            setBatchDeleteOpen(false);
        } catch (error) {
            message.error(localizedErrorMessage(error, "批量删除失败", "Could not delete selected assets", locale));
        }
    };

    return (
        <>
            <WorkspacePage grid className="library-page assets-library-page canvas-library-page">
                <div className="studio-band">
                    <PageHeader
                        title={viewMode === "trash" ? text("素材库 / 回收站", "Asset library / Trash") : text("素材库", "Asset library")}
                        description={viewMode === "trash" ? text("已删除画布或手动归档的临时素材，可随时还原或彻底清理。", "Restore or permanently remove assets from deleted canvases and manual archives.") : text("管理文本、图片、视频、音频和 3D 模型素材。", "Manage text, image, video, audio, and 3D assets.")}
                        meta={<span className="app-projects-header-meta assets-header-meta">{totalAssets} {text("个素材", "assets")}</span>}
                        actions={
                            <div className="assets-header-actions">
                                <div className="assets-header-action-buttons">
                                    {viewMode === "trash" ? (
                                        <>
                                            {trashAssets.length > 0 ? (
                                                <Popconfirm
                                                    title={text("确定清空回收站吗？", "Empty the trash?")}
                                                    description={text("清空后所有回收站素材及其文件将被彻底永久删除，不可恢复。", "All trashed assets and files will be permanently deleted. This cannot be undone.")}
                                                    onConfirm={() => void emptyTrash()}
                                                    okText={text("清空", "Empty trash")}
                                                    okButtonProps={{ danger: true }}
                                                    cancelText={text("取消", "Cancel")}
                                                >
                                                    <Button danger icon={<Trash2 className="size-3.5" />}>
                                                        {text("清空回收站", "Empty trash")}
                                                    </Button>
                                                </Popconfirm>
                                            ) : null}
                                            <Button
                                                icon={<RotateCcw className="size-3.5" />}
                                                onClick={() => {
                                                    setViewMode("library");
                                                    setPage(1);
                                                    setSelectedIds([]);
                                                }}
                                            >
                                                {text("返回素材库", "Back to library")}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button type="primary" icon={<Plus />} onClick={openCreate}>{text("新增素材", "New asset")}</Button>
                                            <Button icon={<Images />} onClick={() => setBatchUploadOpen(true)}>{text("上传图片", "Upload images")}</Button>
                                            <Dropdown trigger={["click"]} menu={{ items: [
                                                ...(pluginCenterEnabled ? [{ key: "eagle", icon: <FolderOpen />, label: text("Eagle 素材库", "Eagle library"), onClick: () => navigate("/plugins/eagle") }] : []),
                                                { key: "package", icon: <FileUp />, label: text("导入素材包", "Import asset package"), onClick: () => assetInputRef.current?.click() },
                                                { key: "model", icon: <Upload />, label: text("上传 3D 模型", "Upload 3D model"), onClick: () => modelInputRef.current?.click() },
                                                { key: "export", icon: <Download />, label: text("导出全部素材", "Export all assets"), onClick: () => void exportAllAssets() },
                                            ] }}>
                                                <Button type="text" aria-label={text("更多素材操作", "More asset actions")} icon={<MoreHorizontal />} />
                                            </Dropdown>
                                        </>
                                    )}
                                </div>
                                <AssetStorageUsage />
                            </div>
                        }
                    />
                    <CollectionToolbar
                        active={Boolean(keyword || kindFilter !== "all" || categoryFilter !== "all" || folderFilter !== "all")}
                        onReset={() => {
                            setKeyword("");
                            setKindFilter("all");
                            setCategoryFilter("all");
                            setFolderFilter("all");
                            setPage(1);
                        }}
                    >
                        <Input
                            allowClear
                            className="w-full sm:w-80"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={text("搜索标题、内容、标签或来源", "Search titles, content, tags, or sources")}
                            onChange={(event) => {
                                setPage(1);
                                setKeyword(event.target.value);
                            }}
                            />
                            <Select
                                aria-label={text("素材显示密度", "Asset display density")}
                                value={gridDensity}
                                className="w-full sm:w-32"
                                prefix={<LayoutGrid aria-hidden className="size-3.5" />}
                                options={assetGridDensityOptions.map((option) => ({ ...option, label: locale === "en-US" ? ({ 6: "Comfortable", 8: "Standard", 10: "Compact" } as Record<number, string>)[option.value] : option.label }))}
                                onChange={(value) => setGridDensity(parseAssetGridDensity(value))}
                            />
                        </CollectionToolbar>
                </div>

                <div className="collection-content assets-collection-content">
                    <div className="assets-collection-layout">
                        <aside className="assets-collection-filters" aria-label={text("素材分类", "Asset filters")}>
                            <div className="assets-collection-filter-scroll">
                            <AssetFilterGroup
                                title={text("素材类型", "Asset type")}
                                options={kindOptions.map((option) => ({ ...option, label: locale === "en-US" ? ({ all: "All", text: "Text", image: "Image", video: "Video", audio: "Audio", model: "3D model" } as Record<string, string>)[option.value] : option.label }))}
                                value={viewMode === "library" ? kindFilter : ""}
                                counts={kindCounts}
                                onChange={(value) => {
                                    setViewMode("library");
                                    setKindFilter(value as AssetKind | "all");
                                    setPage(1);
                                }}
                            />
                            <AssetFilterGroup
                                title={text("业务分类", "Category")}
                                options={categoryOptions.map((option) => ({ ...option, label: option.value === "all" ? text("全部分类", "All categories") : assetCategoryLabel(option.value, locale) }))}
                                value={viewMode === "library" ? categoryFilter : ""}
                                counts={categoryCounts}
                                onChange={(value) => {
                                    setViewMode("library");
                                    setCategoryFilter(value as AssetCategory | "all");
                                    setPage(1);
                                }}
                            />
                            <section className="collection-filter-group assets-folder-filter">
                                <div className="collection-folder-heading">
                                    <span className="collection-filter-label">{text("我的分类", "My categories")}</span>
                                    <button type="button" className="assets-folder-add" title={text("新建分类", "New category")} aria-label={text("新建分类", "New category")} onClick={() => { setFolderName(""); setFolderEditor("new"); }}><FolderPlus className="size-3.5" /></button>
                                </div>
                                <div className="collection-folder-list">
                                    <button type="button" aria-pressed={folderFilter === "all"} className={`assets-filter-item ${folderFilter === "all" ? "is-active" : ""}`} onClick={() => { setFolderFilter("all"); setPage(1); }}>
                                        <span className="assets-filter-item-label">{text("全部", "All")}</span><span className="assets-filter-count">{activeAssets.length}</span>
                                    </button>
                                    <button type="button" aria-pressed={folderFilter === "uncategorized"} className={`assets-filter-item ${folderFilter === "uncategorized" ? "is-active" : ""}`} onClick={() => { setFolderFilter("uncategorized"); setPage(1); }}>
                                        <span className="assets-filter-item-label">{text("未分类", "Uncategorized")}</span><span className="assets-filter-count">{folderCounts[""] ?? activeAssets.filter((asset) => !asset.folderId).length}</span>
                                    </button>
                                    {folders.map((folder) => (
                                        <div key={folder.id} className="assets-folder-row">
                                            <button type="button" aria-pressed={folderFilter === folder.id} className={`assets-filter-item min-w-0 flex-1 ${folderFilter === folder.id ? "is-active" : ""}`} onClick={() => { setFolderFilter(folder.id); setPage(1); }}>
                                                <span className="assets-filter-item-label min-w-0 truncate">{folder.name}</span><span className="assets-filter-count">{folderCounts[folder.id] ?? activeAssets.filter((asset) => asset.folderId === folder.id).length}</span>
                                            </button>
                                            <button type="button" className="product-icon-button" aria-label={locale === "en-US" ? `Rename category ${folder.name}` : `重命名分类 ${folder.name}`} onClick={() => { setFolderName(folder.name); setFolderEditor(folder); }}><PencilLine /></button>
                                            <DeleteButton label={locale === "en-US" ? `Delete category ${folder.name}` : `删除分类 ${folder.name}`} description={text("分类删除后，其中的素材会移至未分类，素材文件会保留。", "Assets in this category become uncategorized. Files are kept.")} onConfirm={() => removeFolder(folder)} />
                                        </div>
                                    ))}
                                </div>
                            </section>
                            </div>
                            <div className="collection-trash-entry">
                                <button
                                    type="button"
                                    aria-pressed={viewMode === "trash"}
                                    className={cn(
                                        "assets-filter-item w-full transition-colors",
                                        viewMode === "trash" ? "is-active !bg-amber-500/15 !text-amber-600 dark:!text-amber-400 font-semibold shadow-sm" : "text-foreground/65 hover:text-foreground",
                                    )}
                                    onClick={() => {
                                        if (viewMode === "trash") {
                                            setViewMode("library");
                                        } else {
                                            setViewMode("trash");
                                            setKindFilter("all");
                                            setCategoryFilter("all");
                                        }
                                        setPage(1);
                                        setSelectedIds([]);
                                    }}
                                >
                                    <span className="assets-filter-item-label flex items-center gap-1.5">
                                        <Trash2 className="size-3.5" />
                                        <span>{text("回收站", "Trash")}</span>
                                    </span>
                                    <span className="assets-filter-count">{trashAssets.length}</span>
                                </button>
                            </div>
                        </aside>
                        <section className="min-w-0">
                            {viewMode === "trash" ? (
                                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-300">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                                        <span>{retentionDays > 0 ? locale === "en-US" ? `Trashed assets are permanently removed after ${retentionDays} days. You can restore or delete them sooner.` : `回收站内的素材将在 ${retentionDays} 天后自动彻底清除。您可以随时还原素材，或手动彻底删除释放空间。` : text("回收站内的素材当前设置为永久保留，您可以随时还原素材或手动彻底清除。", "Trashed assets are kept indefinitely. You can restore or permanently delete them at any time.")}</span>
                                    </div>
                                </div>
                            ) : null}
                            {selectedAssets.length ? (
                                <AssetsBatchBar
                                    count={selectedAssets.length}
                                    isTrash={viewMode === "trash"}
                                    allSelected={allFilteredSelected}
                                    onSelectAll={() => setSelectedIds((current) => Array.from(new Set([...current, ...visibleAssetIds])))}
                                    onClear={() => setSelectedIds([])}
                                    onExport={() => void exportSelectedAssets()}
                                    onRestore={() => void batchRestore()}
                                    onArchive={() => setBatchArchiveOpen(true)}
                                    onDelete={() => setBatchDeleteOpen(true)}
                                />
                            ) : null}
                            {validAssets.length === 0 && totalAssets === 0 ? (
                                viewMode === "trash" ? (
                                    <WorkspaceState icon="assets" compact title={text("回收站是空的", "Trash is empty")} description={text("删除画布或手动移入回收站的素材会暂存到这里，可在需要时随时还原。", "Assets moved to trash will appear here until restored or deleted.")} />
                                ) : (
                                    <AssetsEmptyState onNew={openCreate} onImport={() => assetInputRef.current?.click()} onGoCanvas={() => navigate("/canvas")} />
                                )
                            ) : (
                                <>
                                    {visibleAssets.length === 0 ? (
                                        <WorkspaceState icon="assets" compact title={text("没有匹配的素材", "No matching assets")} description={text("调整关键词或左侧分类后再试。", "Try another keyword or category.")} />
                                    ) : (
                                        <CollectionGrid className="library-grid assets-library-grid" style={{ "--collection-grid-min-width": `${assetGridCardMinWidth[gridDensity]}px` } as React.CSSProperties}>
                                            {visibleAssets.map((asset) => (
                                                <AssetCard
                                                    key={asset.id}
                                                    asset={asset}
                                                    selected={selectedIds.includes(asset.id)}
                                                    isTrash={viewMode === "trash"}
                                                    retentionDays={retentionDays}
                                                    onSelect={(selected) => setSelectedIds((current) => (selected ? [...new Set([...current, asset.id])] : current.filter((id) => id !== asset.id)))}
                                                    onOpen={() => setPreviewAsset(asset)}
                                                    onEdit={() => void openEdit(asset)}
                                                    onCopy={copyAssetText}
                                                    onDownload={downloadImage}
                                                    onRestore={() => void restoreAsset(asset)}
                                                    onArchive={() => setArchivingAsset(asset)}
                                                    onDelete={() => setDeletingAsset(asset)}
                                                    folderOptions={folderSelectOptions}
                                                    onMoveToFolder={(folderId) => void moveAssetsToFolder([asset.id], folderId)}
                                                />
                                            ))}
                                        </CollectionGrid>
                                    )}
                                    <PaginationBar
                                        current={page}
                                        pageSize={pageSize}
                                        total={totalAssets}
                                        pageSizeOptions={[40, 80, 120]}
                                        onChange={(nextPage, nextPageSize) => {
                                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                            setPageSize(nextPageSize);
                                        }}
                                    />
                                </>
                            )}
                        </section>
                    </div>
                </div>
            </WorkspacePage>

            <Modal
                className="workspace-modal workspace-modal-wide library-modal"
                title={editingAsset ? text("编辑素材", "Edit asset") : text("新增素材", "New asset")}
                open={isAssetOpen}
                onCancel={() => {
                    if (!imageUploading) setIsAssetOpen(false);
                }}
                onOk={() => void saveAsset()}
                okText={imageUploading ? text("正在上传", "Uploading") : text("保存", "Save")}
                cancelText={text("取消", "Cancel")}
                confirmLoading={imageUploading}
                cancelButtonProps={{ disabled: imageUploading }}
                closable={!imageUploading}
                destroyOnHidden
            >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", category: "other", tags: [] }}>
                        <Form.Item name="kind" label={text("类型", "Type")}>
                            <Select
                                options={[
                                    { label: text("文本", "Text"), value: "text" },
                                    { label: text("图片", "Image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="category" label={text("业务分类", "Category")}>
                            <Select options={categoryOptions.slice(1).map((option) => ({ ...option, label: assetCategoryLabel(option.value, locale) }))} />
                        </Form.Item>
                        <Form.Item name="title" label={text("标题", "Title")} rules={[{ required: true, message: text("请输入标题", "Enter a title") }]}>
                            <Input placeholder={text("给素材起一个容易检索的名字", "Give the asset a searchable name")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={text("封面 URL", "Cover URL")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={text("可粘贴图片 URL，也可以上传本地封面", "Paste an image URL or upload a local cover")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {text("上传", "Upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={text("标签", "Tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={text("输入标签后回车", "Type a tag and press Enter")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="arkAssetId" label={text("方舟素材 ID", "Ark asset ID")} rules={[{ pattern: /^asset-[A-Za-z0-9-]+$/, message: text("请输入 asset- 开头的方舟素材 ID", "Enter an Ark asset ID starting with asset-") }]}>
                                <Input autoComplete="off" allowClear placeholder={text("asset-…，需为本人或被授权可用的方舟素材", "asset-... You must own or have access to this Ark asset")} />
                            </Form.Item>
                            <Form.Item name="portraitCertified" label={text("人像认证", "Portrait verification")} valuePropName="checked" extra={text("标记已通过火山方舟实人认证的真人人像素材", "Mark real-person portraits verified by Volcengine Ark")}>
                                <Switch aria-label={text("人像认证", "Portrait verification")} />
                            </Form.Item>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={text("来源", "Source")}>
                                <Input placeholder={text("手动添加 / 画布 / 任务中心", "Manual / Canvas / Tasks")} />
                            </Form.Item>
                            <Form.Item name="note" label={text("备注", "Notes")}>
                                <Input placeholder={text("可选", "Optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={text("文本内容", "Text content")} rules={[{ required: true, message: text("请输入文本内容", "Enter text content") }]}>
                                <Input.TextArea rows={8} placeholder={text("保存提示词、说明文案、参考描述等文本素材", "Save prompts, notes, reference descriptions, or other text")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={text("图片内容", "Image content")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button disabled={imageUploading} icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {imageUploading ? text("正在上传图片", "Uploading image") : text("选择图片文件", "Choose image")}
                                    </Button>
                                    {imageFile ? (
                                        <Tag color="gold" className="ml-3">
                                            {text("待保存上传", "Pending upload")}
                                        </Tag>
                                    ) : null}
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs" title={resourceStorageTitle(imageDraft.storageKey)}>
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)} · {resourceStorageLabel(imageDraft.storageKey)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {text("未选择图片", "No image selected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="lg:pl-4">
                        <Typography.Text strong className="text-xs">
                            {text("预览", "Preview")}
                        </Typography.Text>
                        <div className="mt-2 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <div className={`asset-preview-uploading ${imageUploading ? "is-uploading" : ""}`}>
                                    <img src={coverUrl || imageDraft?.dataUrl} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full object-cover" />
                                    {imageUploading && imageUploadProgress ? (
                                        <div className="asset-preview-uploading-panel">
                                            <div className="asset-preview-uploading-copy">
                                                <span>{imageUploadProgress.phase === "confirming" ? text("正在确认资源", "Confirming asset") : text("正在上传到云端", "Uploading to cloud")}</span>
                                                {typeof imageUploadProgress.percent === "number" ? <strong>{imageUploadProgress.percent}%</strong> : null}
                                            </div>
                                            <Progress percent={imageUploadProgress.percent} showInfo={false} size="small" status="active" />
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || text("暂无封面", "No cover")}</div>
                            )}
                            <div className="bg-background p-3">
                                <Typography.Text strong ellipsis className="block">
                                    {title || text("未命名素材", "Untitled asset")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{text("未打标签", "No tags")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <AssetBatchUploadModal open={batchUploadOpen} defaultFolderId={folderFilter !== "all" && folderFilter !== "uncategorized" ? folderFilter : ""} folders={folders} onClose={() => setBatchUploadOpen(false)} onComplete={async () => { setBatchUploadOpen(false); await invalidateAssetLibrary(); }} />

            <Modal
                className="library-modal library-confirm-modal"
                title={folderEditor === "new" ? text("新建分类", "New category") : text("重命名分类", "Rename category")}
                open={Boolean(folderEditor)}
                confirmLoading={folderSaving}
                onCancel={() => { if (!folderSaving) setFolderEditor(null); }}
                onOk={() => void saveFolder()}
                okText={text("保存", "Save")}
                cancelText={text("取消", "Cancel")}
            >
                <Input autoFocus value={folderName} maxLength={40} placeholder={text("例如：角色参考、场景灵感", "For example: Character references, Scene ideas")} onChange={(event) => setFolderName(event.target.value)} onPressEnter={() => void saveFolder()} />
            </Modal>

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />
            <input
                ref={modelInputRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                onChange={(event) => {
                    void readModelFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                }}
            />

            <Modal
                className="library-modal library-confirm-modal"
                title={text("移入回收站", "Move to trash")}
                open={Boolean(archivingAsset)}
                onCancel={() => setArchivingAsset(null)}
                onOk={() => {
                    if (archivingAsset) {
                        void archiveAsset(archivingAsset);
                        setArchivingAsset(null);
                    }
                }}
                okText={text("移入回收站", "Move to trash")}
                cancelText={text("取消", "Cancel")}
            >
                {locale === "en-US" ? `Move "${archivingAsset?.title}" to trash? You can restore it later.` : `确定将「${archivingAsset?.title}」移入回收站吗？移入后不会出现在正常素材库中，可在回收站随时还原。`}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={text("批量移入回收站", "Move selected assets to trash")}
                open={batchArchiveOpen}
                onCancel={() => setBatchArchiveOpen(false)}
                onOk={() => {
                    void batchArchive();
                    setBatchArchiveOpen(false);
                }}
                okText={text("移入回收站", "Move to trash")}
                cancelText={text("取消", "Cancel")}
            >
                {locale === "en-US" ? `Move ${selectedAssets.length} selected assets to trash? You can restore them later.` : `确定将已选择的 ${selectedAssets.length} 个素材移入回收站吗？移入后可随时在回收站批量还原。`}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={text("彻底删除素材", "Permanently delete asset")}
                open={Boolean(deletingAsset)}
                onCancel={() => setDeletingAsset(null)}
                onOk={() => void confirmDelete()}
                okText={text("彻底删除", "Delete permanently")}
                okButtonProps={{ danger: true }}
                cancelText={text("取消", "Cancel")}
            >
                {locale === "en-US" ? `Permanently delete "${deletingAsset?.title}"? Unused server files will be removed. Existing canvas or task references may stop working. This cannot be undone.` : `确定彻底删除「${deletingAsset?.title}」吗？未被其他素材复用的服务器文件会直接释放，原画布或任务中的旧引用可能失效，操作不可恢复。`}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={text("批量彻底删除素材", "Permanently delete selected assets")}
                open={batchDeleteOpen}
                onCancel={() => setBatchDeleteOpen(false)}
                onOk={() => void confirmBatchDelete()}
                okText={text("彻底删除", "Delete permanently")}
                okButtonProps={{ danger: true }}
                cancelText={text("取消", "Cancel")}
            >
                {locale === "en-US" ? `Permanently delete ${selectedAssets.length} selected assets? Unused server files will be removed. Existing references may stop working. This cannot be undone.` : `确定彻底删除已选择的 ${selectedAssets.length} 个素材吗？未被其他素材复用的服务器文件会直接释放，原画布或任务中的旧引用可能失效，操作不可恢复。`}
            </Modal>
        </>
    );
}

function formatExpirationHint(updatedAt: string, retentionDays: number, locale: AppLocale) {
    if (!retentionDays || retentionDays <= 0) return locale === "en-US" ? "Kept indefinitely" : "永久保留";
    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) return locale === "en-US" ? `Kept for ${retentionDays} days` : `保留 ${retentionDays} 天`;
    const expireTime = updatedTime + retentionDays * 24 * 60 * 60 * 1000;
    const remainingMs = expireTime - Date.now();
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    if (remainingDays <= 0) return locale === "en-US" ? "Pending permanent deletion" : "即将彻底清除";
    if (remainingDays === 1) return locale === "en-US" ? "1 day until deletion" : "剩余 1 天过期";
    return locale === "en-US" ? `${remainingDays} days until deletion` : `剩余 ${remainingDays} 天过期`;
}

function formatExpirationDate(updatedAt: string, retentionDays: number, locale: AppLocale) {
    if (!retentionDays || retentionDays <= 0) return locale === "en-US" ? "Kept indefinitely" : "永久保留";
    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) return "";
    const expireDate = new Date(updatedTime + retentionDays * 24 * 60 * 60 * 1000);
    return locale === "en-US" ? `Permanently removed on ${expireDate.toLocaleDateString(locale)}` : `预计于 ${expireDate.getFullYear()}-${String(expireDate.getMonth() + 1).padStart(2, "0")}-${String(expireDate.getDate()).padStart(2, "0")} 彻底清除`;
}

function AssetCard({
    asset,
    selected,
    isTrash = false,
    retentionDays = 30,
    onSelect,
    onOpen,
    onEdit,
    onCopy,
    onDownload,
    onRestore,
    onArchive,
    onDelete,
    folderOptions,
    onMoveToFolder,
}: {
    asset: LibraryAsset;
    selected: boolean;
    isTrash?: boolean;
    retentionDays?: number;
    onSelect: (selected: boolean) => void;
    onOpen: () => void;
    onEdit: () => void;
    onCopy: (asset: LibraryAsset) => void;
    onDownload: (asset: LibraryAsset) => void;
    onRestore?: () => void;
    onArchive?: () => void;
    onDelete: () => void;
    folderOptions: Array<{ label: string; value: string }>;
    onMoveToFolder: (folderId: string) => void;
}) {
    const { locale, text } = useLocaleText();
    const summary = assetSummary(asset, locale);
    const menuItems: MenuProps["items"] = isTrash
        ? [{ key: "restore", icon: <RotateCcw className="size-3.5" />, label: text("还原到素材库", "Restore to library"), onClick: onRestore }, { type: "divider" as const }, { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: text("彻底删除", "Delete permanently"), onClick: onDelete }]
        : [
              ...(asset.kind === "text" || asset.kind === "image" ? [{ key: "edit", icon: <PencilLine className="size-3.5" />, label: text("编辑", "Edit"), onClick: onEdit }] : []),
              ...(asset.kind === "text" ? [{ key: "copy", icon: <Copy className="size-3.5" />, label: text("复制文本", "Copy text"), onClick: () => void onCopy(asset) }] : []),
              ...(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? [{ key: "download", icon: <Download className="size-3.5" />, label: text("下载", "Download"), onClick: () => onDownload(asset) }] : []),
              { key: "move", icon: <FolderOpen className="size-3.5" />, label: text("移动到分类", "Move to category"), children: folderOptions.map((folder) => ({ key: folder.value || "uncategorized", label: folder.value ? folder.label : text("未分类", "Uncategorized"), onClick: () => onMoveToFolder(folder.value) })) },
              { type: "divider" as const },
              { key: "archive", icon: <Trash2 className="size-3.5 text-amber-500" />, label: text("移入回收站", "Move to trash"), onClick: onArchive },
              { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: text("彻底删除", "Delete permanently"), onClick: onDelete },
          ];
    return (
        <AssetLibraryCard selected={selected}>
            <AssetCover asset={asset} selected={selected} isTrash={isTrash} onSelect={onSelect} onOpen={onOpen} menuItems={menuItems} />
            <button type="button" className="asset-collection-body block w-full px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]" onClick={onOpen}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                    <h2 className="truncate text-[var(--fs-body)] font-semibold text-foreground" title={asset.title}>
                        {asset.title}
                    </h2>
                    <span className="asset-collection-date shrink-0 tabular-nums">{formatAssetTime(asset.updatedAt, locale)}</span>
                </div>
                {isTrash ? (
                    <div className="mt-1 flex items-center gap-1 text-[var(--fs-tiny)] font-medium text-amber-600 dark:text-amber-400" title={formatExpirationDate(asset.updatedAt, retentionDays, locale)}>
                        <AlertTriangle className="size-3 shrink-0" />
                        <span>{formatExpirationHint(asset.updatedAt, retentionDays, locale)}</span>
                    </div>
                ) : (
                    <div className="asset-collection-summary mt-1 truncate" title={summary}>
                        {summary}
                    </div>
                )}
                <div className="asset-collection-source mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{asset.source || text("未标注来源", "Source not specified")}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{assetProjectLabel(asset, locale)}</span>
                </div>
            </button>
        </AssetLibraryCard>
    );
}

function isKnownAssetKind(kind: unknown): kind is AssetKind {
    return kind === "image" || kind === "video" || kind === "audio" || kind === "model" || kind === "text";
}

function AssetCover({ asset, selected, isTrash = false, onSelect, onOpen, menuItems }: { asset: LibraryAsset; selected: boolean; isTrash?: boolean; onSelect: (selected: boolean) => void; onOpen: () => void; menuItems: MenuProps["items"] }) {
    const { locale, text } = useLocaleText();
    const kind = isKnownAssetKind(asset.kind) ? asset.kind : undefined;
    const KindIcon = kind ? assetKindIcons[kind] : FileText;
    const clock = asset.kind === "video" || asset.kind === "audio" ? formatAssetClock(asset.data.durationMs) : null;
    const showPlay = asset.kind === "video";
    const isLight = asset.kind === "audio" || asset.kind === "text" || asset.kind === "model";
    return (
        <AssetLibraryCardMedia className={isLight ? "assets-cover is-light" : "assets-cover"}>
            <button type="button" className="assets-cover-link" onClick={onOpen} aria-label={locale === "en-US" ? `View asset: ${asset.title}` : `查看素材：${asset.title}`}>
                {asset.kind === "audio" ? (
                    <AudioWaveCover asset={asset} />
                ) : asset.kind === "text" ? (
                    <TextCover asset={asset} />
                ) : asset.kind === "model" ? (
                    <ModelCover asset={asset} />
                ) : (
                    <AssetMediaPreview
                        asset={asset}
                        alt={asset.title}
                        className="assets-cover-media"
                        fallback={
                            <div className="assets-cover-fallback">
                                <KindIcon className="size-7" />
                            </div>
                        }
                    />
                )}
                <span className="assets-cover-vignette" aria-hidden="true" />
                {showPlay ? (
                    <span className="assets-cover-play">
                        <Play className="size-4" />
                    </span>
                ) : null}
            </button>
            <span className="assets-cover-badges">
                <span className="assets-cover-badge is-kind">
                    <KindIcon />
                    {kind ? assetKindLabel(kind, locale) : text("素材", "Asset")}
                </span>
                {isTrash ? <span className="assets-cover-badge is-category !bg-amber-500/85 !text-white">{text("回收站", "Trash")}</span> : <span className="assets-cover-badge is-category">{assetCategoryLabel(asset.category, locale)}</span>}
                {asset.portraitCertified ? <span className="assets-cover-badge is-category">{text("人像认证", "Portrait verified")}</span> : null}
            </span>
            {clock ? <span className="assets-cover-clock">{clock}</span> : null}
            <input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect(event.target.checked)} className="assets-select-check" aria-label={locale === "en-US" ? `Select ${asset.title}` : `选择 ${asset.title}`} />
            <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
                <button type="button" className="assets-cover-more" aria-label={text("更多素材操作", "More asset actions")} title={text("更多操作", "More actions")}>
                    <MoreHorizontal className="size-4" />
                </button>
            </Dropdown>
        </AssetLibraryCardMedia>
    );
}

function AudioWaveCover({ asset }: { asset: LibraryAsset & { kind: "audio" } }) {
    const bars = audioWaveBars(asset.id);
    return (
        <div className="assets-cover-wave" aria-hidden="true">
            {bars.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
            ))}
            <AudioLines className="assets-cover-wave-glyph" />
        </div>
    );
}

function TextCover({ asset }: { asset: LibraryAsset & { kind: "text" } }) {
    const { text } = useLocaleText();
    return (
        <div className="assets-cover-text">
            <p>{asset.data.content || text("空白文本素材", "Empty text asset")}</p>
        </div>
    );
}

function ModelCover({ asset }: { asset: LibraryAsset & { kind: "model" } }) {
    return (
        <div className="assets-cover-model">
            <Box />
            <span>{asset.data.fileName}</span>
        </div>
    );
}

function AssetsBatchBar({
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
    const { locale, text } = useLocaleText();
    return (
        <div className="assets-batch-bar" role="toolbar" aria-label={text("批量操作", "Batch actions")}>
            <span className="assets-batch-count">
                {locale === "en-US" ? <>Selected <strong>{count}</strong> assets</> : <>已选择 <strong>{count}</strong> 个素材</>}
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

const assetsEmptyBannerFrames = [
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: "ASSET.01 · 天台重逢", englishCaption: "ASSET.01 · Rooftop reunion" },
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: "ASSET.02 · 雨夜霓虹", englishCaption: "ASSET.02 · Neon rain" },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: "ASSET.03 · 暗巷追逐", englishCaption: "ASSET.03 · Alley pursuit" },
];

function AssetsEmptyState({ onNew, onImport, onGoCanvas }: { onNew: () => void; onImport: () => void; onGoCanvas: () => void }) {
    const { text } = useLocaleText();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    return (
        <div className="assets-empty">
            <div className="assets-empty-banner" aria-hidden="true">
                {assetsEmptyBannerFrames.map((frame, index) => (
                    <figure key={frame.caption} className={`assets-empty-banner-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                        <img src={frame.src} alt="" loading="lazy" decoding="async" />
                        <span>{text(frame.caption, frame.englishCaption)}</span>
                    </figure>
                ))}
                <span className="assets-empty-banner-caption">
                    <span>{brandName} {text("素材库", "Asset library")}</span>{text("把每次创作的结果，留档成可复用的资产", "Save each creative result as a reusable asset")}
                </span>
            </div>
            <div className="assets-empty-cards">
                <button type="button" className="assets-empty-card" onClick={onNew}>
                    <span className="assets-empty-card-icon">
                        <Plus />
                    </span>
                    <strong>{text("新建素材", "New asset")}</strong>
                    <span>{text("录入提示词、说明文案，或上传图片资产。", "Add prompts, notes, or an image asset.")}</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onImport}>
                    <span className="assets-empty-card-icon">
                        <FileUp />
                    </span>
                    <strong>{text("导入素材包", "Import asset archive")}</strong>
                    <span>{text("从素材压缩包一键恢复旧资产，继续创作。", "Restore assets from an archive.")}</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onGoCanvas}>
                    <span className="assets-empty-card-icon">
                        <Clapperboard />
                    </span>
                    <strong>{text("去画布保存", "Save from canvas")}</strong>
                    <span>{text("把画布上满意的镜头与画面留档进素材库。", "Keep your favorite shots and frames from the canvas.")}</span>
                </button>
            </div>
        </div>
    );
}

function AssetFilterGroup({
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

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: LibraryAsset | null; onClose: () => void; onCopy: (asset: LibraryAsset) => void; onDownload: (asset: LibraryAsset) => void }) {
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
                            <Tag className="m-0" color="geekblue" title={text("火山方舟素材 ID，生成视频时可直接 asset:// 引用", "Volcengine Ark asset ID; can be referenced as asset:// in video generation")}>
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

function AssetImageZoom({ asset }: { asset: LibraryAsset & { kind: "image" } }) {
    const { text } = useLocaleText();
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
    return (
        <div className="asset-zoom-viewer" onWheel={(event) => { event.preventDefault(); setScale((value) => Math.min(4, Math.max(.25, value * (event.deltaY < 0 ? 1.12 : .89)))); }} onPointerDown={(event) => { if (scale <= 1) return; event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag) return; setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y }); }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
            <img src={asset.coverUrl || asset.data.dataUrl} alt={asset.title} loading="lazy" decoding="async" className="asset-archive-preview-media asset-zoom-image" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
            <div className="asset-zoom-controls" data-canvas-no-zoom>
                <button type="button" title={text("缩小", "Zoom out")} aria-label={text("缩小", "Zoom out")} onClick={() => setScale((value) => Math.max(.25, value / 1.25))}><ZoomOut className="size-4" /></button>
                <button type="button" title={text("恢复适应", "Reset zoom")} aria-label={text("恢复适应", "Reset zoom")} onClick={reset}>{Math.round(scale * 100)}%</button>
                <button type="button" title={text("放大", "Zoom in")} aria-label={text("放大", "Zoom in")} onClick={() => setScale((value) => Math.min(4, value * 1.25))}><ZoomIn className="size-4" /></button>
                <button type="button" title={text("查看原图尺寸", "Original size")} aria-label={text("查看原图尺寸", "Original size")} onClick={() => setScale(1)}><Maximize2 className="size-4" /></button>
            </div>
        </div>
    );
}

function assetArchiveFacts(asset: LibraryAsset, locale: AppLocale) {
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

function assetSummary(asset: LibraryAsset, locale: AppLocale) {
    if (asset.kind === "text") return asset.data.content;
    if (asset.kind === "audio") return `${formatAssetDuration(asset.data.durationMs, locale)} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    if (asset.kind === "model") return `${asset.data.fileName} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    return `${assetSizeLabel(asset.data.width, asset.data.height, locale)} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSizeLabel(width: number, height: number, locale: AppLocale) {
    return width > 0 && height > 0 ? `${width}x${height}` : locale === "en-US" ? "Unknown" : "未知";
}

function StorageTag({ asset }: { asset: LibraryAsset }) {
    if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return null;
    const location = resourceStorageLocation(asset.data.storageKey);
    const color = location === "oss" ? "green" : location === "local" ? "gold" : "default";
    return (
        <Tag color={color} className="m-0 text-[var(--fs-label)]" title={resourceStorageTitle(asset.data.storageKey)}>
            {resourceStorageLabel(asset.data.storageKey)}
        </Tag>
    );
}

function assetSearchText(asset: LibraryAsset, locale: AppLocale) {
    return [asset.title, asset.source || "", asset.note || "", assetCategoryLabel(asset.category, locale), (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function assetProjectLabel(asset: LibraryAsset, locale: AppLocale) {
    const projectName = asset.metadata?.projectName;
    if (typeof projectName === "string" && projectName.trim()) return projectName;
    return Array.isArray(asset.metadata?.projectIds) && asset.metadata.projectIds.length ? locale === "en-US" ? "Linked project" : "已关联项目" : locale === "en-US" ? "No linked project" : "未关联项目";
}

function assetKindLabel(kind: AssetKind, locale: AppLocale) {
    return locale === "en-US" ? kind === "image" ? "Image" : kind === "video" ? "Video" : kind === "audio" ? "Audio" : kind === "model" ? "3D model" : "Text" : kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : kind === "model" ? "3D 模型" : "文本";
}

function assetDownloadLabel(asset: LibraryAsset, locale: AppLocale) {
    if (asset.kind === "video") return locale === "en-US" ? "Download video" : "下载视频";
    if (asset.kind === "audio") return locale === "en-US" ? "Download audio" : "下载音频";
    if (asset.kind === "model") return locale === "en-US" ? "Download model" : "下载模型";
    return locale === "en-US" ? "Download image" : "下载图片";
}

function readAssetGridDensity(): AssetGridDensity {
    if (typeof window === "undefined") return 8;
    return parseAssetGridDensity(window.localStorage.getItem(ASSET_GRID_DENSITY_KEY));
}

function assetCountMap<T extends { label: string; value: string }>(options: T[], remote: Record<string, number> | undefined, fallback: LibraryAsset[], valueOf: (asset: LibraryAsset) => string) {
    const result = new Map<string, number>();
    options.forEach((option) => {
        // 列表只展示 LibraryAsset（entity 角色卡被排除）；"全部"计数只能累加选项里声明的类型，
        // 否则远端 facets 里的 entity 会计入"全部"，出现计数 30 但列表为空的矛盾。
        if (remote) result.set(option.value, option.value === "all" ? options.reduce((sum, item) => item.value === "all" ? sum : sum + (remote[item.value] || 0), 0) : remote[option.value] || 0);
        else result.set(option.value, option.value === "all" ? fallback.length : fallback.filter((asset) => valueOf(asset) === option.value).length);
    });
    return result;
}

function formatAssetDuration(durationMs: number | undefined, locale: AppLocale) {
    if (!durationMs) return locale === "en-US" ? "Unknown duration" : "时长未知";
    return `${Math.round(durationMs / 100) / 10} ${locale === "en-US" ? "s" : "秒"}`;
}

function formatAssetClock(durationMs?: number) {
    if (!durationMs || durationMs < 1000) return null;
    const total = Math.round(durationMs / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatAssetTime(value: string, locale: AppLocale) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" });
}

function formatAssetDateTime(value: string, locale: AppLocale) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function audioWaveBars(seed: string) {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const bars: number[] = [];
    for (let index = 0; index < 26; index += 1) {
        hash = (hash * 9301 + 49297) % 233280;
        const random = hash / 233280;
        const envelope = 0.35 + 0.65 * Math.abs(Math.sin(index * 0.55 + 1.2));
        bars.push(Math.round((0.18 + 0.82 * random * envelope) * 100));
    }
    return bars;
}
