import { Button, Input, InputNumber } from "antd";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { normalizeStoryboardKeyframes } from "@/lib/canvas/canvas-storyboard-keyframes";
import type { CanvasNodeData, StoryboardKeyframePromptDescription, StoryboardRow } from "@/types/canvas";
import { StoryboardAssetsCell } from "@/components/canvas/storyboard-assets-cell";

export type CanvasStoryboardKeyframeEditorProps = {
    row: StoryboardRow;
    nodes: CanvasNodeData[];
    disabled?: boolean;
    onUpdate: (keyframeId: string, patch: Partial<StoryboardKeyframePromptDescription>) => void;
    onAdd: (afterKeyframeId?: string) => void;
    onRemove: (keyframeId: string) => void;
    onReorder: (orderedIds: string[]) => void;
};

export function CanvasStoryboardKeyframeEditor({ row, nodes, disabled = false, onUpdate, onAdd, onRemove, onReorder }: CanvasStoryboardKeyframeEditorProps) {
    const keyframes = normalizeStoryboardKeyframes(row);
    const move = (keyframeId: string, direction: -1 | 1) => {
        const index = keyframes.findIndex((item) => item.id === keyframeId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= keyframes.length) return;
        const ids = keyframes.map((item) => item.id);
        [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
        onReorder(ids);
    };
    return (
        <div className="flex min-w-[360px] flex-col gap-2 rounded-md border border-black/10 p-2 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold">关键帧图片提示词 · {keyframes.length} 张</div>
                <Button size="small" icon={<Plus className="size-3.5" />} disabled={disabled} onClick={() => onAdd(keyframes.at(-1)?.id)}>添加关键帧</Button>
            </div>
            {keyframes.length ? keyframes.map((item, index) => {
                const seconds = Math.max(0, Number(row.durationSeconds) || 0) * item.timeRatio;
                return (
                    <div key={item.id} className="grid gap-2 rounded border border-black/10 p-2 dark:border-white/10" style={{ gridTemplateColumns: "38px minmax(0, 1fr) 78px auto" }}>
                        <div className="flex flex-col items-center justify-center gap-0.5 text-[11px] opacity-65">
                            <span>{index + 1}</span>
                            <span>{seconds.toFixed(1)}s</span>
                        </div>
                        <Input.TextArea rows={2} value={item.prompt} disabled={disabled} placeholder="关键帧画面提示词" onChange={(event) => onUpdate(item.id, { prompt: event.target.value, promptTemplateVariables: undefined })} />
                        <InputNumber min={0} max={Math.max(1, Number(row.durationSeconds) || 1)} step={0.1} value={seconds} disabled={disabled} addonAfter="秒" onChange={(value) => onUpdate(item.id, { timeRatio: Math.min(1, Math.max(0, Number(value) / Math.max(1, Number(row.durationSeconds) || 1))) })} />
                        <div className="flex items-start gap-1">
                            <Button size="small" type="text" aria-label="上移关键帧" icon={<ChevronUp className="size-3.5" />} disabled={disabled || index === 0} onClick={() => move(item.id, -1)} />
                            <Button size="small" type="text" aria-label="下移关键帧" icon={<ChevronDown className="size-3.5" />} disabled={disabled || index === keyframes.length - 1} onClick={() => move(item.id, 1)} />
                            <Button size="small" type="text" danger aria-label="删除关键帧" icon={<Trash2 className="size-3.5" />} disabled={disabled} onClick={() => onRemove(item.id)} />
                        </div>
                        <div className="col-span-full">
                            <StoryboardAssetsCell bindings={item.assetBindings || []} nodes={nodes} limit={4} disabled={disabled} onChange={(assetBindings) => onUpdate(item.id, { assetBindings })} />
                        </div>
                    </div>
                );
            }) : <div className="rounded border border-dashed border-black/15 p-3 text-center text-xs opacity-60 dark:border-white/15">暂无关键帧。添加后可从分镜行右侧创建关键帧组。</div>}
        </div>
    );
}
