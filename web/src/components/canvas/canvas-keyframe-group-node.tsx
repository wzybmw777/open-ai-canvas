import { ChevronDown, ChevronUp, Plus, RefreshCw, Trash2 } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { normalizeStoryboardKeyframes, sortStoryboardKeyframes } from "@/lib/canvas/canvas-storyboard-keyframes";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData, StoryboardKeyframePromptDescription, StoryboardRow } from "@/types/canvas";
import "./canvas-keyframe-group-node.css";

export type KeyframeGroupPresentationItem = {
    keyframeId: string;
    prompt: string;
    seconds: number;
    image?: CanvasNodeData;
    state: "ready" | "loading" | "error" | "missing";
    isFirst: boolean;
    isLast: boolean;
    timeRatio: number;
};

export function buildKeyframeGroupPresentation(row: StoryboardRow, imageNodes: CanvasNodeData[]): KeyframeGroupPresentationItem[] {
    const images = new Map(imageNodes.map((image) => [image.id, image]));
    const keyframes = sortStoryboardKeyframes(normalizeStoryboardKeyframes(row));
    const duration = Math.max(0, Number(row.durationSeconds) || 0);
    return keyframes.map((keyframe, index) => {
        const image = keyframe.imageNodeId ? images.get(keyframe.imageNodeId) : undefined;
        const state = image?.metadata?.status === "error" || keyframe.status === "error"
            ? "error"
            : image?.metadata?.status === "loading" || keyframe.status === "loading"
              ? "loading"
              : image
                ? "ready"
                : "missing";
        return {
            keyframeId: keyframe.id,
            prompt: keyframe.prompt,
            seconds: duration * keyframe.timeRatio,
            image,
            state,
            isFirst: index === 0,
            isLast: index === keyframes.length - 1,
            timeRatio: keyframe.timeRatio,
        };
    });
}

export type CanvasKeyframeGroupNodeContentProps = {
    node: CanvasNodeData;
    row: StoryboardRow;
    imageNodes: CanvasNodeData[];
    theme: CanvasTheme;
    readOnly?: boolean;
    onUpdateKeyframe?: (keyframeId: string, patch: Partial<StoryboardKeyframePromptDescription>) => void;
    onAddKeyframe?: (afterKeyframeId?: string) => void;
    onRemoveKeyframe?: (keyframeId: string) => void;
    onReorderKeyframes?: (orderedIds: string[]) => void;
    onRegenerateKeyframe?: (keyframeId: string) => void;
};

function stateLabel(item: KeyframeGroupPresentationItem) {
    if (item.state === "ready") return item.isFirst && item.isLast ? "首尾帧" : item.isFirst ? "首帧" : item.isLast ? "尾帧" : "参考帧";
    if (item.state === "loading") return "生成中";
    if (item.state === "error") return "生成失败";
    return "待生成";
}

export function CanvasKeyframeGroupNodeContent({ row, imageNodes, theme, readOnly = false, onUpdateKeyframe, onAddKeyframe, onRemoveKeyframe, onReorderKeyframes, onRegenerateKeyframe }: CanvasKeyframeGroupNodeContentProps) {
    const items = buildKeyframeGroupPresentation(row, imageNodes);
    const orderedIds = items.map((item) => item.keyframeId);
    return (
        <div className="canvas-keyframe-group" style={{ background: theme.node.panel, color: theme.node.text }}>
            <div className="canvas-keyframe-group__header">
                <div>
                    <div className="canvas-keyframe-group__title">镜头 {row.shotNumber} · 关键帧组</div>
                    <div className="canvas-keyframe-group__summary">{items.length} 张 · {row.durationSeconds || 0} 秒 · 首尾帧控制时间线</div>
                </div>
                {!readOnly && onAddKeyframe ? <button type="button" className="canvas-keyframe-group__icon-button" onClick={() => onAddKeyframe(items.at(-1)?.keyframeId)} aria-label="添加关键帧"><Plus size={15} /></button> : null}
            </div>
            {items.length ? (
                <div className="canvas-keyframe-group__timeline" style={{ borderColor: theme.timeline.trackBorder, background: theme.timeline.trackFill }}>
                    <div className="canvas-keyframe-group__track" aria-hidden="true" style={{ background: theme.timeline.clipVideo }} />
                    <div className="canvas-keyframe-group__items">
                        {items.map((item) => (
                            <div key={item.keyframeId} className="canvas-keyframe-group__item" style={{ left: `${item.timeRatio * 100}%` }}>
                                <div className="canvas-keyframe-group__marker" style={{ background: item.isFirst || item.isLast ? theme.accent.primary : theme.timeline.playhead }} />
                                <div className="canvas-keyframe-group__time">{item.seconds.toFixed(1)}s</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="canvas-keyframe-group__empty" style={{ borderColor: theme.node.edge, color: theme.node.muted }}>先在分镜行添加关键帧图片提示词</div>
            )}
            <div className="canvas-keyframe-group__cards">
                {items.map((item) => (
                    <div key={item.keyframeId} className="canvas-keyframe-group__card" style={{ borderColor: theme.node.edge, background: theme.node.fill }}>
                        <div className="canvas-keyframe-group__thumb" style={{ background: theme.node.panel }}>
                            {item.image?.metadata?.content || item.image?.metadata?.storageKey ? <CachedResourceImage storageKey={item.image.metadata.storageKey} src={item.image.metadata.content} alt={item.prompt || "关键帧"} loading="lazy" decoding="async" draggable={false} className="size-full object-cover" /> : <span style={{ color: theme.node.muted }}>无图</span>}
                            <span className="canvas-keyframe-group__badge">{stateLabel(item)}</span>
                        </div>
                        <div className="canvas-keyframe-group__card-body">
                            <div className="canvas-keyframe-group__card-meta">{item.seconds.toFixed(1)}s · {item.isFirst && item.isLast ? "首尾" : item.isFirst ? "起始" : item.isLast ? "结束" : "过程"}</div>
                            {readOnly ? <div className="canvas-keyframe-group__prompt">{item.prompt || "未填写提示词"}</div> : <textarea className="canvas-keyframe-group__prompt-input" value={item.prompt} onChange={(event) => onUpdateKeyframe?.(item.keyframeId, { prompt: event.target.value, promptTemplateVariables: undefined })} aria-label={`关键帧 ${item.seconds.toFixed(1)} 秒提示词`} rows={2} />}
                            {!readOnly ? <div className="canvas-keyframe-group__actions">
                                {onReorderKeyframes ? <>
                                    <button type="button" onClick={() => onReorderKeyframes([...orderedIds.slice(0, orderedIds.indexOf(item.keyframeId) - 1), item.keyframeId, ...orderedIds.slice(orderedIds.indexOf(item.keyframeId) - 1, orderedIds.indexOf(item.keyframeId)), ...orderedIds.slice(orderedIds.indexOf(item.keyframeId) + 1)])} disabled={orderedIds.indexOf(item.keyframeId) <= 0} aria-label="关键帧上移"><ChevronUp size={13} /></button>
                                    <button type="button" onClick={() => onReorderKeyframes([...orderedIds.slice(0, orderedIds.indexOf(item.keyframeId)), ...orderedIds.slice(orderedIds.indexOf(item.keyframeId) + 1, orderedIds.indexOf(item.keyframeId) + 2), item.keyframeId, ...orderedIds.slice(orderedIds.indexOf(item.keyframeId) + 2)])} disabled={orderedIds.indexOf(item.keyframeId) >= orderedIds.length - 1} aria-label="关键帧下移"><ChevronDown size={13} /></button>
                                </> : null}
                                <button type="button" onClick={() => onRegenerateKeyframe?.(item.keyframeId)} aria-label={`重新生成 ${item.seconds.toFixed(1)} 秒关键帧`}><RefreshCw size={13} />生成</button>
                                <button type="button" onClick={() => onRemoveKeyframe?.(item.keyframeId)} aria-label={`删除 ${item.seconds.toFixed(1)} 秒关键帧`}><Trash2 size={13} />删除</button>
                            </div> : null}
                        </div>
                    </div>
                ))}
            </div>
            {orderedIds.length > 1 ? <div className="canvas-keyframe-group__footer">使用上移/下移调整顺序；中间图片作为视频参考图</div> : null}
        </div>
    );
}
