// Shared image selection editor; uses semantic surface, selection and text tokens.
import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type Ref } from "react";
import { Button, Segmented, Slider } from "antd";
import { exportEditMask, paintMaskStrokes, type MaskPoint, type MaskStroke } from "@/lib/canvas/image-mask-document";
import { useImageToolSource } from "@/hooks/use-image-tool-source";

export type ImageMaskEditorHandle = { exportMask: () => string };

export function ImageMaskEditor({ dataUrl, ref, disabled = false, onReady, onSelectionChange }: {
    dataUrl: string;
    ref?: Ref<ImageMaskEditorHandle>;
    disabled?: boolean;
    onReady?: (ready: boolean) => void;
    onSelectionChange?: () => void;
}) {
    const { size, error: loadError } = useImageToolSource(dataUrl);
    const surface = useRef<HTMLCanvasElement>(null);
    const strokes = useRef<MaskStroke[]>([]);
    const activePointer = useRef<number | null>(null);
    const frame = useRef<number | null>(null);
    const [diameter, setDiameter] = useState(60);
    const [mode, setMode] = useState("paint");
    const [error, setError] = useState("");
    const [strokeCount, setStrokeCount] = useState(0);

    useEffect(() => { onReady?.(Boolean(size) && !loadError); }, [size, loadError, onReady]);
    useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
    useImperativeHandle(ref, () => ({ exportMask: () => {
        if (!size) throw new Error(loadError || "图片尚未读取完成");
        return exportEditMask(size.width, size.height, strokes.current);
    } }), [size, loadError]);
    const repaint = () => {
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (!surface.current) return;
            try {
                const color = getComputedStyle(surface.current).getPropertyValue("--selection-bg").trim() || getComputedStyle(surface.current).color;
                paintMaskStrokes(surface.current, strokes.current, color);
            } catch (failure) { setError(failure instanceof Error ? failure.message : "遮罩预览失败"); }
        });
    };
    const pointAt = (event: PointerEvent<HTMLCanvasElement>): MaskPoint => {
        const rect = event.currentTarget.getBoundingClientRect();
        return [((event.clientX - rect.left) * event.currentTarget.width) / Math.max(1, rect.width), ((event.clientY - rect.top) * event.currentTarget.height) / Math.max(1, rect.height)];
    };
    const finishStroke = (event: PointerEvent<HTMLCanvasElement>) => {
        if (activePointer.current !== event.pointerId) return;
        activePointer.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setStrokeCount(strokes.current.length);
        onSelectionChange?.();
    };
    return <section data-canvas-no-zoom className="flex min-w-0 flex-col gap-4">
        <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg bg-surface-active p-3">
            <div className="relative max-w-full select-none overflow-hidden rounded-lg">
                <img src={dataUrl} alt="待处理原图" draggable={false} className="block max-h-[62vh] max-w-full" />
                {size ? <canvas ref={surface} width={size.width} height={size.height} aria-label="涂抹需要修改的图片区域" className="absolute inset-0 h-full w-full touch-none cursor-crosshair text-primary opacity-40"
                    onPointerDown={(event) => {
                        if (disabled || event.button !== 0 || activePointer.current !== null) return;
                        event.preventDefault(); event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        activePointer.current = event.pointerId;
                        strokes.current.push({ diameter, erase: mode === "erase", points: [pointAt(event)] });
                        setError(""); repaint();
                    }}
                    onPointerMove={(event) => {
                        if (disabled || activePointer.current !== event.pointerId) return;
                        event.preventDefault();
                        strokes.current.at(-1)?.points.push(pointAt(event)); repaint();
                    }} onPointerUp={finishStroke} onPointerCancel={finishStroke} onLostPointerCapture={finishStroke} /> : null}
            </div>
        </div>
        <p className="text-sm text-muted-foreground">{size ? `${size.width} × ${size.height} px · 涂抹区域将被修复` : loadError || "正在读取图片…"}</p>
        <div className="flex flex-wrap items-center gap-3">
            <Segmented disabled={disabled} value={mode} onChange={setMode} options={[{ label: "画笔", value: "paint" }, { label: "擦除", value: "erase" }]} />
            <Button disabled={disabled || !strokeCount} onClick={() => { strokes.current.pop(); setStrokeCount(strokes.current.length); repaint(); onSelectionChange?.(); }}>撤销笔画</Button>
            <Button disabled={disabled} onClick={() => { strokes.current = []; activePointer.current = null; setStrokeCount(0); setError(""); repaint(); onSelectionChange?.(); }}>清空遮罩</Button>
        </div>
        <label className="text-sm">笔刷直径 · {diameter} px<Slider disabled={disabled} min={8} max={160} step={2} value={diameter} onChange={setDiameter} /></label>
        {error || loadError ? <p role="alert" className="text-sm text-destructive">{error || loadError}</p> : null}
    </section>;
}
