import { uploadImage } from "@/services/image-storage";
import { assetStorageUsageQueryKey, AssetStorageUsage } from "./asset-storage-usage";
import { readFileAsDataUrl, readImageMeta, formatBytes } from "@/lib/image-utils";
import { uploadMediaFile } from "@/services/file-storage";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { WorkspacePage, PageHeader, CollectionGrid, PaginationBar } from "@/components/layout/workspace-page";
import { Trash2, RotateCcw, Plus, Images, FolderOpen, FileUp, Upload, Download, MoreHorizontal, Search, LayoutGrid, FolderPlus, PencilLine, AlertTriangle } from "lucide-react";
import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { Select } from "@/components/ui/base/select";
import { AssetFilterGroup, AssetsBatchBar, AssetsEmptyState, AssetDrawer } from "./asset-library-panels";
import { DeleteButton } from "@/components/ui/base/buttons/delete-button";
import { cn } from "@/lib/utils";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { AssetCard } from "./asset-library-cards";
import { Switch } from "@/components/ui/base/switch";
import { resourceStorageTitle, resourceStorageLabel } from "@/lib/canvas/resource-storage-status";
import { AssetBatchUploadModal } from "./asset-batch-upload-modal";
import { assetGridCardMinWidth, type AssetGridDensity, assetGridDensityOptions, parseAssetGridDensity } from "./asset-grid-density";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Form, Popconfirm, Button, Dropdown, Input, Modal, Space, Tag, Typography, Progress } from "antd";
import { useNavigate } from "react-router";
import { useCopyText } from "@/hooks/use-copy-text";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ASSET_CATEGORY_OPTIONS, assetCategoryLabel } from "@/lib/asset-category";
import { downloadBrowserMedia } from "@/services/browser-download";
import { flushAssetStorePersistence, useAssetStore, type AssetCategory, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { loadAssetLibraryPage, loadAssetsForUse, saveRemoteUserDataNow, localSavedRemotePendingMessage, deleteAssetsWithRemoteSync, deleteAssetWithRemoteSync } from "@/services/user-data-sync";
import { useUserStore } from "@/stores/use-user-store";
import { createAssetFolder, deleteAssetFolder, listAssetFolders, updateAssetFolder, type AssetFolder, moveRemoteAssetsToFolder } from "@/services/api/user-data";
import { assetCountMap, assetSearchText, readAssetGridDensity, assetKindIcons } from "./asset-library-format";
import { ASSET_GRID_DENSITY_KEY, type LibraryAsset } from "./asset-library-format";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";

export { ASSET_GRID_DENSITY_KEY, type LibraryAsset, assetKindIcons } from "./asset-library-format";

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
    { label: "角色", value: "entity" },
];

const categoryOptions = [{ label: "全部分类", value: "all" }, ...ASSET_CATEGORY_OPTIONS];
const ASSET_LIBRARY_QUERY_KEY = ["asset-library"] as const;
const ASSET_FOLDER_QUERY_KEY = ["asset-folders"] as const;
type AssetFolderFilter = "all" | "uncategorized" | string;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { locale, text } = useLocaleText();
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

    const allLibraryAssets = useMemo(() => assets, [assets]);
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
    const remotePageAssets = useMemo(() => assetPageQuery.data?.assets || [], [assetPageQuery.data?.assets]);
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
    ], [folders, text]);

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
            message.success(locale === "en-US" ? `Deleted ${folder.name}. Its assets are now uncategorized.` : `已删除分类「${folder.name}」，其中素材已移至未分类`);
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
        let editableAsset = useAssetStore.getState().assets.find((item) => item.id === asset.id);
        if (!editableAsset) {
            try {
                // 分页卡片是轻量 DTO，编辑前补齐完整记录，避免保存时覆盖远端 metadata。
                await loadAssetsForUse([asset.id]);
                editableAsset = useAssetStore.getState().assets.find((item) => item.id === asset.id);
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

        await flushAssetStorePersistence();
        try {
            await saveRemoteUserDataNow();
            await invalidateAssetLibrary();
            message.success(editingAsset ? text("素材已更新", "Asset updated") : text("素材已保存", "Asset saved"));
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(editingAsset ? text("素材已在本地更新", "Asset updated locally") : text("素材已在本地保存", "Asset saved locally"), error));
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
        if (uploaded.pendingRemoteUpload) message.warning(locale === "en-US" ? `3D model saved locally but not uploaded${uploaded.remoteUploadError ? `: ${uploaded.remoteUploadError}` : ""}` : `3D 模型已保存在本机，尚未上传到服务器${uploaded.remoteUploadError ? `：${uploaded.remoteUploadError}` : ""}`);
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
            await saveRemoteUserDataNow();
            message.success(locale === "en-US" ? `Restored ${asset.title}` : `已还原素材「${asset.title}」`);
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(text("已在本地还原", "Restored locally"), error));
        }
    };

    const batchRestore = async () => {
        if (!selectedIds.length) return;
        try {
            await ensureAssetsInStore(selectedIds);
            for (const id of selectedIds) updateAsset(id, { status: "confirmed" });
            const count = selectedIds.length;
            setSelectedIds([]);
            await flushAssetStorePersistence();
            await saveRemoteUserDataNow();
            message.success(locale === "en-US" ? `Restored ${count} assets` : `已还原 ${count} 个素材`);
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(text("已在本地还原", "Restored locally"), error));
        }
    };

    const archiveAsset = async (asset: LibraryAsset) => {
        try {
            await ensureAssetsInStore([asset.id]);
            updateAsset(asset.id, { status: "archived" });
            await flushAssetStorePersistence();
            await saveRemoteUserDataNow();
            message.success(locale === "en-US" ? `Moved ${asset.title} to trash` : `已将「${asset.title}」移入回收站`);
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(text("已移入回收站", "Moved to trash locally"), error));
        }
    };

    const batchArchive = async () => {
        if (!selectedIds.length) return;
        try {
            await ensureAssetsInStore(selectedIds);
            for (const id of selectedIds) updateAsset(id, { status: "archived" });
            const count = selectedIds.length;
            setSelectedIds([]);
            await flushAssetStorePersistence();
            await saveRemoteUserDataNow();
            message.success(locale === "en-US" ? `Moved ${count} assets to trash` : `已将 ${count} 个素材移入回收站`);
        } catch (error) {
            message.warning(localSavedRemotePendingMessage(text("已移入回收站", "Moved to trash locally"), error));
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
                                                { key: "eagle", icon: <FolderOpen />, label: text("Eagle 素材库", "Eagle library"), onClick: () => navigate("/plugins/eagle") },
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
                                options={assetGridDensityOptions}
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
                                options={kindOptions.map((option) => ({ ...option, label: text(option.label, { all: "All", text: "Text", image: "Image", video: "Video", audio: "Audio", model: "3D model" }[option.value] || option.label) }))}
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
                                <Input placeholder={text("可粘贴图片 URL，也可以上传本地封面", "Paste an image URL or upload a cover")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {text("上传", "Upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={text("标签", "Tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={text("输入标签后回车", "Enter a tag and press Enter")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="arkAssetId" label={text("方舟素材 ID", "Ark asset ID")} rules={[{ pattern: /^asset-[A-Za-z0-9-]+$/, message: text("请输入 asset- 开头的方舟素材 ID", "Enter an Ark asset ID starting with asset-") }]}>
                                <Input autoComplete="off" allowClear placeholder={text("asset-…，需为本人或被授权可用的方舟素材", "asset-... owned by you or shared with you")} />
                            </Form.Item>
                            <Form.Item name="portraitCertified" label={text("人像认证", "Portrait verification")} valuePropName="checked" extra={text("标记已通过火山方舟实人认证的真人人像素材", "Mark portraits verified for real-person use in Ark")}>
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
                                <Input.TextArea rows={8} placeholder={text("保存提示词、说明文案、参考描述等文本素材", "Save prompts, notes, and reference descriptions")} />
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
                                                <span>{imageUploadProgress.phase === "confirming" ? text("正在确认资源", "Confirming resource") : text("正在上传到云端", "Uploading to cloud")}</span>
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
                <Input autoFocus value={folderName} maxLength={40} placeholder={text("例如：角色参考、场景灵感", "For example: Character references, scene ideas")} onChange={(event) => setFolderName(event.target.value)} onPressEnter={() => void saveFolder()} />
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
                {locale === "en-US" ? `Move ${archivingAsset?.title || ""} to trash? You can restore it later.` : `确定将「${archivingAsset?.title || ""}」移入回收站吗？移入后不会出现在正常素材库中，可在回收站随时还原。`}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={text("批量移入回收站", "Move selected to trash")}
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
                title={text("彻底删除素材", "Delete asset permanently")}
                open={Boolean(deletingAsset)}
                onCancel={() => setDeletingAsset(null)}
                onOk={() => void confirmDelete()}
                okText={text("彻底删除", "Delete permanently")}
                okButtonProps={{ danger: true }}
                cancelText={text("取消", "Cancel")}
            >
                {locale === "en-US" ? `Permanently delete ${deletingAsset?.title || ""}? This cannot be undone.` : `确定彻底删除「${deletingAsset?.title || ""}」吗？未被其他素材复用的服务器文件会直接释放，原画布或任务中的旧引用可能失效，操作不可恢复。`}
            </Modal>
            <Modal
                className="library-modal library-confirm-modal"
                title={text("批量彻底删除素材", "Delete selected assets permanently")}
                open={batchDeleteOpen}
                onCancel={() => setBatchDeleteOpen(false)}
                onOk={() => void confirmBatchDelete()}
                okText={text("彻底删除", "Delete permanently")}
                okButtonProps={{ danger: true }}
                cancelText={text("取消", "Cancel")}
            >
                {locale === "en-US" ? `Permanently delete ${selectedAssets.length} selected assets? This cannot be undone.` : `确定彻底删除已选择的 ${selectedAssets.length} 个素材吗？未被其他素材复用的服务器文件会直接释放，原画布或任务中的旧引用可能失效，操作不可恢复。`}
            </Modal>
        </>
    );
}
