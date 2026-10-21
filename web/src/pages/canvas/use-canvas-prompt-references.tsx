import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App, Input } from "antd";
import { nanoid } from "nanoid";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { AddCanvasReferenceAction } from "@/components/canvas/canvas-node-prompt-references";
import { AppModal } from "@/components/ui/product/app-modal";
import { connectCanvasNodeReferences } from "@/lib/canvas/canvas-node-references";
import { canvasConnectionError } from "@/lib/canvas/canvas-connection-policy";
import { CANVAS_UPLOAD_ACCEPT, uploadNodeType } from "@/lib/canvas/canvas-file-upload";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { buildCanvasResourceReferences, getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

type Options = {
    canvasId: string;
    config: AiConfig;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    createAssetPayloadNode: (payload: InsertAssetPayload, center: Position) => Promise<CanvasNodeData>;
    createFileNode: (file: File, center: Position, replaceId?: string, options?: { preserveSelection?: boolean; isCurrent?: () => boolean }) => Promise<string | null>;
};

export function useCanvasPromptReferences({ canvasId, config, nodes, connections, nodesRef, connectionsRef, setNodes, setConnections, createAssetPayloadNode, createFileNode }: Options) {
    const { message } = App.useApp();
    const [picker, setPicker] = useState<{ targetId: string; action: Exclude<AddCanvasReferenceAction, "upload"> } | null>(null);
    const [text, setText] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<string | null>(null);
    const lifetime = useMemo(() => ({ active: true }), [canvasId]);
    useEffect(() => {
        lifetime.active = true;
        setPicker(null);
        uploadTargetRef.current = null;
        return () => { lifetime.active = false; };
    }, [lifetime]);

    const getTarget = useCallback((targetId: string) => {
        if (!lifetime.active) throw new Error("画布已切换，请重新添加参考");
        const target = nodesRef.current.find((node) => node.id === targetId);
        if (!target) throw new Error("参考目标节点已不存在");
        if (target.metadata?.locked) throw new Error("无法修改锁定节点的引用");
        return target;
    }, [lifetime, nodesRef]);

    const commitReferences = useCallback((targetId: string, sourceIds: string[], created: CanvasNodeData[] = []) => {
        getTarget(targetId);
        const result = connectCanvasNodeReferences([...nodesRef.current, ...created], connectionsRef.current, targetId, sourceIds, config, nanoid);
        nodesRef.current = result.nodes;
        connectionsRef.current = result.connections;
        setNodes(result.nodes);
        setConnections(result.connections);
    }, [config, connectionsRef, getTarget, nodesRef, setConnections, setNodes]);

    const sourcePosition = useCallback((targetId: string, offset = 0): Position => {
        const target = getTarget(targetId);
        return { x: target.position.x - 240, y: target.position.y + target.height / 2 + offset * 300 };
    }, [getTarget]);

    const openReferenceAdder = useCallback((targetId: string, action: AddCanvasReferenceAction) => {
        try {
            getTarget(targetId);
            if (action === "upload") {
                uploadTargetRef.current = targetId;
                inputRef.current?.click();
            } else {
                setText("");
                setPicker({ targetId, action });
            }
        } catch (error) {
            message.warning(error instanceof Error ? error.message : "无法添加参考");
        }
    }, [getTarget, message]);

    const canvasItems = useMemo<AssetLibraryPickerItem[]>(() => {
        if (picker?.action !== "canvas") return [];
        const activeIds = new Set(getGenerationResourceNodes(picker.targetId, nodes, connections).map((node) => node.id));
        return buildCanvasResourceReferences(nodes, connections).filter((reference) => reference.nodeId !== picker.targetId).map((reference) => {
            const kind = reference.kind === "character" ? "image" : reference.kind;
            const policyError = canvasConnectionError(config, nodes, connections, { fromNodeId: reference.nodeId, toNodeId: picker.targetId }, { ignoreCapacity: true });
            return {
                id: reference.nodeId, title: reference.title || reference.label, category: "canvas", kindLabel: reference.label,
                mediaKind: kind === "image" || kind === "video" || kind === "audio" ? kind : "text",
                imageUrl: kind === "image" || kind === "video" ? reference.previewUrl : undefined, imageStorageKey: reference.previewStorageKey || (kind === "image" ? reference.storageKey : undefined),
                description: reference.text?.slice(0, 160), searchText: `${reference.label} ${reference.title}`,
                disabledReason: activeIds.has(reference.nodeId) ? "已关联到当前节点" : policyError || undefined,
            };
        });
    }, [config, connections, nodes, picker]);

    const referenceDialogs = <>
        {picker?.action === "canvas" ? <AssetLibraryPickerModal
            open title="选择参考节点" eyebrow="当前画布" items={canvasItems} categoryLabels={{ all: "全部节点", canvas: "画布节点" }} mediaKinds={["image", "video", "audio", "text"]}
            confirmLabel={(count) => `关联并引用${count ? `（${count}）` : ""}`} emptyTitle="没有可用的参考节点" emptyDescription="先在画布添加素材，或使用素材库、上传和新建文本入口。"
            footerNote="关联到当前节点并自动插入提示词引用；原素材保留。" onClose={() => setPicker(null)}
            onConfirm={(ids) => { commitReferences(picker.targetId, ids); setPicker(null); }}
        /> : null}
        {picker?.action === "library" ? <AssetPickerModal open onClose={() => setPicker(null)} onInsert={async (payloads) => {
            getTarget(picker.targetId);
            const created = await Promise.all(payloads.map((payload, index) => createAssetPayloadNode(payload, sourcePosition(picker.targetId, index))));
            commitReferences(picker.targetId, created.map((node) => node.id), created);
        }} /> : null}
        {picker?.action === "text" ? <AppModal open title="新建文本参考" okText="添加并引用" cancelText="取消" okButtonProps={{ disabled: !text.trim() }} onCancel={() => setPicker(null)} onOk={() => {
            try {
                const content = text.trim();
                if (!content) return;
                const created = createCanvasNode(CanvasNodeType.Text, sourcePosition(picker.targetId), { content, status: "success" });
                created.title = content.slice(0, 32);
                commitReferences(picker.targetId, [created.id], [created]);
                setPicker(null);
            } catch (error) {
                message.warning(error instanceof Error ? error.message : "添加文本参考失败");
            }
        }}><Input.TextArea autoFocus aria-label="参考文本内容" value={text} onChange={(event) => setText(event.target.value)} autoSize={{ minRows: 4, maxRows: 12 }} placeholder="输入人物设定、场景说明或其他参考文本" /></AppModal> : null}
        <input ref={inputRef} type="file" multiple accept={CANVAS_UPLOAD_ACCEPT} hidden aria-label="上传参考文件" onChange={async (event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            const targetId = uploadTargetRef.current;
            uploadTargetRef.current = null;
            if (!targetId || !files.length) return;
            try {
                getTarget(targetId);
                // 上传前校验整组媒体类型，避免上传后才发现当前节点无法接受它们。
                const placeholders = files.map((file, index) => {
                    const type = uploadNodeType(file);
                    if (!type) throw new Error("请选择图片、视频、音频或文本文件");
                    return createCanvasNode(type, sourcePosition(targetId, index), { content: "pending-upload" });
                });
                connectCanvasNodeReferences([...nodesRef.current, ...placeholders], connectionsRef.current, targetId, placeholders.map((node) => node.id), config, nanoid);
                const ids: string[] = [];
                for (const [index, file] of files.entries()) {
                    const id = await createFileNode(file, sourcePosition(targetId, index), undefined, { preserveSelection: true, isCurrent: () => lifetime.active });
                    if (id) ids.push(id);
                }
                if (ids.length) commitReferences(targetId, ids);
            } catch (error) {
                if (lifetime.active) message.warning(error instanceof Error ? error.message : "添加参考文件失败");
            }
        }} />
    </>;

    return { openReferenceAdder, referenceDialogs };
}
