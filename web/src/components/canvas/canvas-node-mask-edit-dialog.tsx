import { useRef, useState } from "react";
import { Collapse, Input } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import { ImageMaskEditor, type ImageMaskEditorHandle } from "@/components/image-mask-editor";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

export type CanvasImageMaskEditPayload = {
    maskDataUrl: string;
    prompt: string;
    generationConfig?: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality" | "count" | "transparentBackground">>;
};
type MaskEditorProps = { dataUrl: string; open: boolean; config: AiConfig; onClose: () => void; onConfirm: (payload: CanvasImageMaskEditPayload) => void };

export function CanvasNodeMaskEditDialog(props: MaskEditorProps) {
    return props.open && props.dataUrl ? <MaskEditor key={props.dataUrl} {...props} /> : null;
}

function MaskEditor({ dataUrl, config, onClose, onConfirm }: MaskEditorProps) {
    const editor = useRef<ImageMaskEditorHandle>(null);
    const [ready, setReady] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [settings, setSettings] = useState(config);
    const [error, setError] = useState("");
    const theme = canvasThemes[useActiveTheme()];

    const submit = () => {
        if (!prompt.trim()) return setError("请填写修改要求");
        if (!ready || !editor.current) return;
        let maskDataUrl: string;
        try { maskDataUrl = editor.current.exportMask(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "遮罩生成失败"); return; }
        const { model, imageModel, quality, count, transparentBackground } = settings;
        onConfirm({ prompt: prompt.trim(), maskDataUrl, generationConfig: { model, imageModel, size: settings.size, quality, count, transparentBackground } });
    };
    return (
        <AppModal open centered title="局部重绘" className="workspace-modal workspace-modal-wide" onCancel={onClose} onOk={submit} okText="AI 修改" okButtonProps={{ disabled: !ready }}>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <ImageMaskEditor dataUrl={dataUrl} ref={editor} onReady={setReady} />
                <section className="flex max-h-[68vh] flex-col gap-4 overflow-y-auto pr-1">
                    <label className="flex flex-col gap-2 text-sm">修改要求<Input.TextArea rows={4} value={prompt} placeholder="描述选中区域需要发生的变化" onChange={(event) => { setPrompt(event.target.value); setError(""); }} /></label>
                    <Collapse defaultActiveKey={["settings"]} items={[{ key: "settings", label: "生成设置", children: <div className="space-y-4">
                        <ModelPicker config={settings} value={settings.imageModel || settings.model} capability="image" fullWidth showSelectedPrice={false} onChange={(model) => setSettings((previous) => ({ ...previous, ...defaultImageParamsForModel(previous, model), imageModel: model, model }))} />
                        <ImageSettingsPanel config={settings} theme={theme} showTitle={false} showCount={false} bypassPriceGuard onConfigChange={(key, value) => setSettings((previous) => ({ ...previous, [key]: value }))} />
                    </div> }]} />
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                </section>
            </div>
        </AppModal>
    );
}
