import { App, Button, ColorPicker, Dropdown, Input, Popover } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { AppModal } from "@/components/ui/product/app-modal";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    Bold,
    ChevronDown,
    Code2,
    Eraser,
    Highlighter,
    Italic,
    Link2,
    List,
    ListOrdered,
    Minus,
    MoreHorizontal,
    Quote,
    Redo2,
    Save,
    Strikethrough,
    Underline,
    Undo2,
    X,
} from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { createCanvasRichTextExtensions, isSafeCanvasRichTextLink } from "@/lib/canvas/canvas-rich-text";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type CanvasTextEditorModalProps = {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onSave: (nodeId: string, title: string, content: string, richText: Record<string, unknown>) => Promise<void> | void;
};

export function CanvasTextEditorModal({ node, open, onClose, onSave }: CanvasTextEditorModalProps) {
    const { locale, text } = useLocaleText();
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const [title, setTitle] = useState("");
    const [markdownContent, setMarkdownContent] = useState("");
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const markdownEditorRef = useRef<TextAreaRef | null>(null);
    const isMarkdown = node?.type === CanvasNodeType.Markdown;
    const editor = useEditor({
        immediatelyRender: false,
        extensions: createCanvasRichTextExtensions(text("输入文本内容…", "Enter text…")),
        content: emptyTextDocument(),
        editorProps: {
            attributes: {
                class: "min-h-full px-8 py-7 text-[var(--fs-body-lg)] leading-7 outline-none sm:px-12 lg:px-16",
                "aria-label": text("文本节点富文本编辑区", "Rich text editor for text node"),
            },
        },
        onUpdate: () => setDirty(true),
    });

    useEffect(() => {
        if (!open || !node) return;
        setTitle(node.title || (node.type === CanvasNodeType.Markdown ? "Markdown" : text("文本", "Text")));
        setMarkdownContent(node.metadata?.content || "");
        setDirty(false);
        setSaving(false);
        if (node.type === CanvasNodeType.Markdown) {
            window.setTimeout(() => markdownEditorRef.current?.focus(), 0);
            return;
        }
        if (!editor) return;
        editor.commands.setContent((node.metadata?.richText as JSONContent | undefined) || plainTextDocument(node.metadata?.content || ""), { emitUpdate: false });
        window.setTimeout(() => editor.commands.focus("start"), 0);
    }, [editor, node?.id, node?.type, open]);

    const characterCount = isMarkdown ? markdownContent.length : editor?.storage.characterCount?.characters?.() || 0;
    const wordCount = useMemo(() => countWords(isMarkdown ? markdownContent : editor?.getText() || ""), [characterCount, editor, isMarkdown, markdownContent]);

    const save = async () => {
        if (!node || saving || (!isMarkdown && !editor)) return;
        setSaving(true);
        try {
            if (isMarkdown) {
                await onSave(node.id, title.trim() || "Markdown", markdownContent, (node.metadata?.richText as Record<string, unknown> | undefined) || {});
            } else {
                await onSave(node.id, title.trim() || text("文本", "Text"), editor!.getText({ blockSeparator: "\n" }).trimEnd(), editor!.getJSON() as Record<string, unknown>);
            }
            setDirty(false);
            message.success(text("文本节点已保存", "Text node saved"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "文本保存失败", "Could not save text", locale));
        } finally {
            setSaving(false);
        }
    };

    const close = () => {
        if (!dirty || saving) return onClose();
        modal.confirm({
            title: text("放弃未保存的修改？", "Discard unsaved changes?"),
            content: locale === "en-US" ? `Your ${isMarkdown ? "Markdown" : "rich text"} changes will not be saved to the canvas node.` : `关闭后，本次${isMarkdown ? "Markdown" : "富文本"}编辑不会写回画布节点。`,
            okText: text("放弃修改", "Discard changes"),
            cancelText: text("继续编辑", "Keep editing"),
            onOk: onClose,
        });
    };

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
            event.preventDefault();
            void save();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [dirty, editor, isMarkdown, markdownContent, node?.id, open, saving, title]);

    return (
        <AppModal
            className="canvas-text-editor-modal"
            open={open && Boolean(node)}
            title={null}
            footer={null}
            closable={false}
            centered
            destroyOnHidden
            width="min(1180px, calc(100vw - 24px))"
            onCancel={close}
            flush styles={{ container: { borderRadius: 8 } }}
        >
            <section className="flex h-[min(88dvh,840px)] flex-col overflow-hidden" style={{ background: theme.node.panel, color: theme.node.text }}>
                <header className="flex h-13 shrink-0 items-center gap-3 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                    <Input
                        variant="borderless"
                        value={title}
                        onChange={(event) => { setTitle(event.target.value); setDirty(true); }}
                        className="!h-9 min-w-0 max-w-[360px] flex-1 !px-1 text-sm font-semibold"
                        placeholder={text("文本节点标题", "Text node title")}
                        aria-label={text("文本节点标题", "Text node title")}
                    />
                    <span className="hidden shrink-0 text-[var(--fs-label)] sm:inline" style={{ color: theme.node.muted }}>{locale === "en-US" ? `${characterCount.toLocaleString(locale)} chars · ${wordCount.toLocaleString(locale)} words` : `${characterCount.toLocaleString(locale)} 字 · ${wordCount.toLocaleString(locale)} 词`}</span>
                    <span className="ml-auto hidden text-[var(--fs-label)] sm:inline" style={{ color: dirty ? theme.accent.primary : theme.node.muted }}>{dirty ? text("有未保存修改", "Unsaved changes") : text("已保存", "Saved")}</span>
                    <Button size="small" type="primary" icon={<Save className="size-3.5" />} loading={saving} disabled={!dirty} onClick={() => void save()}>{text("保存", "Save")}</Button>
                    <Tooltip title={text("关闭", "Close")}>
                        <Button size="small" type="text" icon={<X className="size-4" />} aria-label={text("关闭文本编辑器", "Close text editor")} onClick={close} />
                    </Tooltip>
                </header>

                {isMarkdown ? (
                    <div className="flex h-10 shrink-0 items-center border-b px-4 text-xs font-medium" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                        {text("Markdown 源码", "Markdown source")}
                    </div>
                ) : (
                    <TextEditorToolbar editor={editor} />
                )}

                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto" style={{ background: theme.canvas.background }}>
                    <div
                        className="mx-auto min-h-full w-full max-w-[920px] [&_.ProseMirror]:min-h-[calc(min(88dvh,840px)-126px)] [&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline [&_.ProseMirror_blockquote]:my-4 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:opacity-70 [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-black/6 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 dark:[&_.ProseMirror_code]:bg-white/8 [&_.ProseMirror_h1]:mb-4 [&_.ProseMirror_h1]:mt-6 [&_.ProseMirror_h1]:text-3xl [&_.ProseMirror_h1]:font-semibold [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-5 [&_.ProseMirror_h2]:text-2xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:text-xl [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_hr]:my-6 [&_.ProseMirror_li]:my-1 [&_.ProseMirror_ol]:my-3 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_p]:my-2 [&_.ProseMirror_pre]:my-4 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-md [&_.ProseMirror_pre]:bg-black/90 [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:text-white [&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-foreground/35 [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]"
                    >
                        {isMarkdown ? (
                            <Input.TextArea
                                ref={markdownEditorRef}
                                value={markdownContent}
                                onChange={(event) => {
                                    setMarkdownContent(event.target.value);
                                    setDirty(true);
                                }}
                                placeholder={text("输入 Markdown 内容…", "Enter Markdown…")}
                                autoSize={false}
                                className="!min-h-[calc(min(88dvh,840px)-126px)] !h-full !resize-none !border-0 !bg-transparent !px-8 !py-7 !text-sm !leading-7 !shadow-none focus:!border-0 focus:!shadow-none sm:!px-12 lg:!px-16"
                                aria-label={text("Markdown 源码编辑区", "Markdown source editor")}
                            />
                        ) : (
                            <EditorContent editor={editor} />
                        )}
                    </div>
                </div>

                <footer className="flex h-8 shrink-0 items-center gap-3 border-t px-3 text-[var(--fs-tiny)]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <span className="hidden sm:inline">{isMarkdown ? text("直接编辑 Markdown 源码，保存后画布会按 Markdown 渲染", "Edit Markdown source; the canvas renders it after saving") : text("支持标题、列表、引用、链接、代码和颜色格式", "Headings, lists, quotes, links, code, and colors")}</span>
                    <span className="ml-auto">Ctrl/⌘S {text("保存", "Save")}</span>
                </footer>
            </section>
        </AppModal>
    );
}

function TextEditorToolbar({ editor }: { editor: Editor | null }) {
    const { text } = useLocaleText();
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const [, setToolbarVersion] = useState(0);
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkValue, setLinkValue] = useState("");

    useEffect(() => {
        if (!editor) return;
        const update = () => setToolbarVersion((value) => value + 1);
        editor.on("selectionUpdate", update);
        editor.on("transaction", update);
        return () => {
            editor.off("selectionUpdate", update);
            editor.off("transaction", update);
        };
    }, [editor]);

    const blockLabel = editor?.isActive("heading", { level: 1 }) ? "标题 1" : editor?.isActive("heading", { level: 2 }) ? "标题 2" : editor?.isActive("heading", { level: 3 }) ? "标题 3" : "正文";
    const alignment = editor?.isActive({ textAlign: "center" }) ? "center" : editor?.isActive({ textAlign: "right" }) ? "right" : editor?.isActive({ textAlign: "justify" }) ? "justify" : "left";
    const alignmentIcon = alignment === "center" ? <AlignCenter /> : alignment === "right" ? <AlignRight /> : alignment === "justify" ? <AlignJustify /> : <AlignLeft />;
    const applyLink = () => {
        const href = linkValue.trim();
        if (!editor) return;
        if (href && !isSafeCanvasRichTextLink(href)) {
            message.error(text("链接仅支持 http、https、mailto 或 tel 协议", "Links must use http, https, mailto, or tel"));
            return;
        }
        if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
        else editor.chain().focus().unsetLink().run();
        setLinkOpen(false);
    };

    return (
        <div className="hide-scrollbar flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <EditorToolButton label={text("撤销", "Undo")} onClick={() => editor?.chain().focus().undo().run()}><Undo2 /></EditorToolButton>
            <EditorToolButton label={text("重做", "Redo")} onClick={() => editor?.chain().focus().redo().run()}><Redo2 /></EditorToolButton>
            <ToolbarDivider />
            <Dropdown
                trigger={["click"]}
                menu={{
                    selectedKeys: [blockLabel],
                    items: ["正文", "标题 1", "标题 2", "标题 3"].map((label) => ({ key: label, label: label === "正文" ? text("正文", "Paragraph") : text("标题", "Heading") + label.slice(-2) })),
                    onClick: ({ key }) => key === "正文" ? editor?.chain().focus().setParagraph().run() : editor?.chain().focus().toggleHeading({ level: Number(key.slice(-1)) as 1 | 2 | 3 }).run(),
                }}
            >
                <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium outline-none hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8" aria-label={text("段落格式", "Paragraph format")}><span>{blockLabel === "正文" ? text("正文", "Paragraph") : text("标题", "Heading") + blockLabel.slice(-2)}</span><ChevronDown className="size-3" /></button>
            </Dropdown>
            <EditorToolButton label={text("粗体", "Bold")} active={Boolean(editor?.isActive("bold"))} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold /></EditorToolButton>
            <EditorToolButton label={text("斜体", "Italic")} active={Boolean(editor?.isActive("italic"))} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic /></EditorToolButton>
            <EditorToolButton label={text("下划线", "Underline")} active={Boolean(editor?.isActive("underline"))} onClick={() => editor?.chain().focus().toggleUnderline().run()}><Underline /></EditorToolButton>
            <EditorToolButton label={text("删除线", "Strikethrough")} active={Boolean(editor?.isActive("strike"))} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough /></EditorToolButton>
            <ToolbarDivider />
            <Dropdown
                trigger={["click"]}
                menu={{
                    selectedKeys: [alignment],
                    items: [
                        { key: "left", icon: <AlignLeft className="size-3.5" />, label: text("左对齐", "Align left") },
                        { key: "center", icon: <AlignCenter className="size-3.5" />, label: text("居中", "Center") },
                        { key: "right", icon: <AlignRight className="size-3.5" />, label: text("右对齐", "Align right") },
                        { key: "justify", icon: <AlignJustify className="size-3.5" />, label: text("两端对齐", "Justify") },
                    ],
                    onClick: ({ key }) => editor?.chain().focus().setTextAlign(key).run(),
                }}
            >
                <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center gap-0.5 rounded-md outline-none hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8" aria-label={text("文字对齐", "Text alignment")}><span className="[&_svg]:size-3.5">{alignmentIcon}</span><ChevronDown className="size-2.5" /></button>
            </Dropdown>
            <EditorToolButton label={text("无序列表", "Bulleted list")} active={Boolean(editor?.isActive("bulletList"))} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List /></EditorToolButton>
            <EditorToolButton label={text("有序列表", "Numbered list")} active={Boolean(editor?.isActive("orderedList"))} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered /></EditorToolButton>
            <EditorToolButton label={text("引用", "Quote")} active={Boolean(editor?.isActive("blockquote"))} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote /></EditorToolButton>
            <Popover
                open={linkOpen}
                onOpenChange={(next) => { setLinkOpen(next); if (next) setLinkValue(String(editor?.getAttributes("link").href || "")); }}
                trigger="click"
                placement="bottom"
                content={<div className="flex w-72 gap-2"><Input size="small" value={linkValue} placeholder="https://example.com" onChange={(event) => setLinkValue(event.target.value)} onPressEnter={applyLink} /><Button size="small" type="primary" onClick={applyLink}>{text("应用", "Apply")}</Button></div>}
            >
                <span><EditorToolButton label={text("插入链接", "Insert link")} active={Boolean(editor?.isActive("link"))} onClick={() => setLinkOpen(true)}><Link2 /></EditorToolButton></span>
            </Popover>
            <ToolbarDivider />
            <Tooltip title={text("文字颜色", "Text color")}>
                <ColorPicker value={String(editor?.getAttributes("textStyle").color || theme.node.text)} onChangeComplete={(color) => editor?.chain().focus().setColor(color.toHexString()).run()}>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-xs font-bold outline-none hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8" aria-label={text("文字颜色", "Text color")}><span className="border-b-2 px-0.5" style={{ borderColor: String(editor?.getAttributes("textStyle").color || theme.node.text) }}>A</span></button>
                </ColorPicker>
            </Tooltip>
            <Tooltip title={text("高亮颜色", "Highlight color")}>
                <ColorPicker value={String(editor?.getAttributes("highlight").color || "#fde68a")} onChangeComplete={(color) => editor?.chain().focus().toggleHighlight({ color: color.toHexString() }).run()}>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md outline-none hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8" aria-label={text("高亮颜色", "Highlight color")}><Highlighter className="size-3.5" /></button>
                </ColorPicker>
            </Tooltip>
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                    items: [
                        { key: "code", icon: <Code2 className="size-3.5" />, label: text("行内代码", "Inline code") },
                        { key: "codeBlock", icon: <span className="text-[var(--fs-tiny)] font-bold">{"<>"}</span>, label: text("代码块", "Code block") },
                        { key: "rule", icon: <Minus className="size-3.5" />, label: text("插入分隔线", "Insert divider") },
                        { type: "divider" },
                        { key: "clear", icon: <Eraser className="size-3.5" />, label: text("清除格式", "Clear formatting") },
                    ],
                    onClick: ({ key }) => {
                        if (key === "code") editor?.chain().focus().toggleCode().run();
                        else if (key === "codeBlock") editor?.chain().focus().toggleCodeBlock().run();
                        else if (key === "rule") editor?.chain().focus().setHorizontalRule().run();
                        else if (key === "clear") editor?.chain().focus().clearNodes().unsetAllMarks().run();
                    },
                }}
            >
                <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md outline-none hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8" aria-label={text("更多格式", "More formatting")}><MoreHorizontal className="size-4" /></button>
            </Dropdown>
        </div>
    );
}

function EditorToolButton({ label, active = false, children, onClick }: { label: string; active?: boolean; children: ReactNode; onClick: () => void }) {
    const theme = canvasThemes[useActiveTheme()];
    return (
        <Tooltip title={label}>
            <button type="button" aria-label={label} aria-pressed={active} className="grid size-8 shrink-0 place-items-center rounded-md outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/8 [&_svg]:size-3.5" style={{ background: active ? theme.toolbar.activeBg : undefined, color: active ? theme.accent.primary : undefined }} onClick={onClick}>{children}</button>
        </Tooltip>
    );
}

function ToolbarDivider() {
    return <span className="mx-1 h-5 w-px shrink-0 bg-black/10 dark:bg-white/10" />;
}

function emptyTextDocument(): JSONContent {
    return { type: "doc", content: [{ type: "paragraph" }] };
}

function plainTextDocument(content: string): JSONContent {
    if (!content) return emptyTextDocument();
    return {
        type: "doc",
        content: content.split("\n").map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : undefined })),
    };
}

function countWords(content: string) {
    const latinWords = content.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
    const cjkCharacters = content.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0;
    return latinWords + cjkCharacters;
}
