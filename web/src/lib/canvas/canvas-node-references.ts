import { canvasConnectionError } from "./canvas-connection-policy";
import { nodeGenerationPrompt } from "./generation-contract";
import { writeCanvasNodePrompt } from "./canvas-node-prompt";
import { applyCanvasConnectionPromptSync, buildCanvasNodeMentionReferenceMap, buildCanvasResourceReferences, canvasResourceMentionToken, getGenerationResourceNodes, replaceCanvasMentionToken } from "./canvas-resource-references";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

function editableTarget(nodes: CanvasNodeData[], targetId: string) {
    const target = nodes.find((node) => node.id === targetId);
    if (!target) throw new Error("参考目标节点已不存在");
    if (target.metadata?.locked) throw new Error("无法修改锁定节点的引用");
    return target;
}

export function disconnectCanvasNodeReference(nodes: CanvasNodeData[], connections: CanvasConnection[], targetId: string, sourceId: string) {
    const target = editableTarget(nodes, targetId);
    const nextConnections = connections.filter((edge) => edge.fromNodeId !== sourceId || edge.toNodeId !== targetId);
    const excluded = [...new Set([...(target.metadata?.excludedReferenceNodeIds || []), sourceId])];
    const nextNodes = nodes.map((node) => node.id === targetId ? { ...node, metadata: { ...node.metadata, excludedReferenceNodeIds: excluded, referenceInputsEdited: true } } : node);
    return { nodes: applyCanvasConnectionPromptSync(nodes, connections, nextNodes, nextConnections), connections: nextConnections };
}

export function connectCanvasNodeReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], targetId: string, sourceIds: string[], config: AiConfig, createId: () => string) {
    const target = editableTarget(nodes, targetId);
    const selectedIds = [...new Set(sourceIds)];
    const availableIds = new Set(buildCanvasResourceReferences(nodes, connections).map((reference) => reference.nodeId));
    for (const sourceId of selectedIds) {
        if (sourceId === targetId || !availableIds.has(sourceId)) throw new Error("无法引用该素材节点");
        const pending = [targetId];
        const visited = new Set<string>();
        while (pending.length) {
            const id = pending.pop()!;
            if (id === sourceId) throw new Error("该引用会形成循环连线");
            if (visited.has(id)) continue;
            visited.add(id);
            pending.push(...connections.filter((edge) => edge.fromNodeId === id).map((edge) => edge.toNodeId));
        }
    }

    // 子节点开始使用自己的入边后不再回退到批次根，先保留它原本继承的参考。
    const inheritedIds = target.metadata?.batchRootId ? getGenerationResourceNodes(targetId, nodes, connections).map((node) => node.id) : [];
    const nextConnections = [...connections];
    for (const sourceId of [...new Set([...inheritedIds, ...selectedIds])]) {
        if (!nextConnections.some((edge) => edge.fromNodeId === sourceId && edge.toNodeId === targetId)) {
            nextConnections.push({ id: createId(), fromNodeId: sourceId, toNodeId: targetId });
        }
    }
    const nextExcluded = target.metadata?.excludedReferenceNodeIds?.filter((id) => !selectedIds.includes(id));
    let nextNodes = nodes.map((node) => node.id === targetId ? { ...node, metadata: { ...node.metadata, excludedReferenceNodeIds: nextExcluded, referenceInputsEdited: true } } : node);
    // 模型容量检查包含分镜、批次和配置引用，避免只数本次新增的直接连线。
    const effectiveInputs = getGenerationResourceNodes(targetId, nextNodes, nextConnections);
    const policyConnections = effectiveInputs.map((node) => ({ id: node.id, fromNodeId: node.id, toNodeId: targetId }));
    for (const sourceId of selectedIds) {
        const error = canvasConnectionError(config, nextNodes, policyConnections, { fromNodeId: sourceId, toNodeId: targetId });
        if (error) throw new Error(error);
    }
    nextNodes = applyCanvasConnectionPromptSync(nodes, connections, nextNodes, nextConnections);
    const references = buildCanvasNodeMentionReferenceMap(nextNodes, nextConnections).get(targetId) || [];
    const updatedTarget = nextNodes.find((node) => node.id === targetId)!;
    const prompt = nodeGenerationPrompt(updatedTarget);
    const previousReferences = buildCanvasNodeMentionReferenceMap(nodes, connections).get(targetId) || [];
    const previousPrompt = nodeGenerationPrompt(target);
    const hadExplicitReferences = /@\[(?:asset|node):/u.test(previousPrompt) || previousReferences.some((reference) => replaceCanvasMentionToken(previousPrompt, canvasResourceMentionToken(reference), "") !== previousPrompt);
    // 首次插入 @ 会让生成切换为显式引用模式，必须保留原先自动传入的素材。
    const tokens = references.filter((reference) => !hadExplicitReferences || selectedIds.includes(reference.nodeId)).filter((reference) => {
        return replaceCanvasMentionToken(prompt, canvasResourceMentionToken(reference), "") === prompt
            && replaceCanvasMentionToken(prompt, `@[node:${reference.nodeId}]`, "") === prompt;
    }).map(canvasResourceMentionToken);
    if (tokens.length) {
        const nextPrompt = /^参考资产[：:]/u.test(prompt)
            ? prompt.replace(/^(参考资产[：:][^\n]*)/u, `$1 ${tokens.join(" ")}`)
            : `参考资产：${tokens.join(" ")}${prompt ? `\n${prompt}` : ""}`;
        nextNodes = nextNodes.map((node) => node.id === targetId ? writeCanvasNodePrompt(node, nextPrompt) : node);
    }
    return { nodes: nextNodes, connections: nextConnections };
}

export function reorderCanvasNodeReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], targetId: string, orderedIds: string[]) {
    editableTarget(nodes, targetId);
    const activeIds = getGenerationResourceNodes(targetId, nodes, connections).map((node) => node.id);
    const uniqueIds = [...new Set(orderedIds)];
    if (uniqueIds.length !== orderedIds.length || uniqueIds.some((id) => !activeIds.includes(id))) throw new Error("参考素材已变化，请重新排序");
    const nextNodes = nodes.map((node) => node.id === targetId ? { ...node, metadata: { ...node.metadata, referenceNodeOrder: [...uniqueIds, ...activeIds.filter((id) => !uniqueIds.includes(id))], referenceInputsEdited: true } } : node);
    return { nodes: applyCanvasConnectionPromptSync(nodes, connections, nextNodes, connections), connections };
}
