import { App, Button, Form, Input, Modal, Upload, type UploadFile } from "antd";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/components/ui/base/switch";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { FileArchive, FileText, GitBranch, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";

import { fallbackSkillCategories, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { installGitHubSkill, installSkillUpload, type Skill } from "@/services/api/skills";

type InstallMode = "markdown" | "zip" | "github";

type InstallFormValues = {
    name?: string;
    description?: string;
    tag: string;
    is_public: boolean;
    url?: string;
    ref?: string;
    subdir?: string;
    autoUpdate: boolean;
};

const modeOptions = [
    { value: "markdown", label: <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" />Markdown</span> },
    { value: "zip", label: <span className="inline-flex items-center gap-1.5"><FileArchive className="size-3.5" />ZIP 技能包</span> },
    { value: "github", label: <span className="inline-flex items-center gap-1.5"><GitBranch className="size-3.5" />GitHub</span> },
];

export function SkillInstallModal({ open, onClose, onInstalled, onManualCreate }: { open: boolean; onClose: () => void; onInstalled: (skill: Skill) => void; onManualCreate: () => void }) {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const [form] = Form.useForm<InstallFormValues>();
    const [mode, setMode] = useState<InstallMode>("markdown");
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [installing, setInstalling] = useState(false);

    useEffect(() => {
        if (!open) return;
        setMode("markdown");
        setFileList([]);
        form.setFieldsValue({ tag: "creative", is_public: true, autoUpdate: true, name: "", description: "", url: "", ref: "", subdir: "" });
    }, [form, open]);

    const install = async () => {
        const values = await form.validateFields();
        const file = fileList[0]?.originFileObj;
        if (mode !== "github" && !file) {
            message.warning(locale === "en-US" ? `Select a ${mode === "zip" ? "ZIP skill package" : "Markdown file"}` : `请选择一个 ${mode === "zip" ? "ZIP 技能包" : "Markdown 文件"}`);
            return;
        }
        setInstalling(true);
        try {
            const result = mode === "github"
                ? await installGitHubSkill({
                    url: values.url || "",
                    ref: values.ref || undefined,
                    subdir: values.subdir || undefined,
                    tag: values.tag,
                    isPrivate: !values.is_public,
                    autoUpdate: values.autoUpdate,
                })
                : await installSkillUpload({
                    file: file as File,
                    sourceType: mode,
                    name: values.name || undefined,
                    description: values.description || undefined,
                    tag: values.tag,
                    isPrivate: !values.is_public,
                });
            message.success(text("技能已安装", "Skill installed"));
            onInstalled(result.skill);
        } catch (error) {
            message.error(localizedErrorMessage(error, "技能安装失败", "Could not install skill", locale));
        } finally {
            setInstalling(false);
        }
    };

    return (
        <Modal
            className="skill-install-modal"
            open={open}
            width={680}
            destroyOnHidden
            mask={{ closable: !installing }}
            title={text("安装技能", "Install skill")}
            onCancel={onClose}
            footer={(
                <div className="flex items-center justify-between gap-3">
                    <Button type="text" onClick={onManualCreate}>{text("从空白创建单文件技能", "Create a skill from scratch")}</Button>
                    <div className="flex gap-2"><Button onClick={onClose}>{text("取消", "Cancel")}</Button><Button type="primary" loading={installing} onClick={() => void install()}>{text("安装技能", "Install skill")}</Button></div>
                </div>
            )}
        >
            <p className="mb-4 text-sm leading-6 text-foreground/55">{text("支持标准", "Install a standard")} <code>SKILL.md</code>{text("、包含多层目录的 ZIP 技能包，或公开 GitHub 仓库。名称和简介会优先从技能入口自动读取。", ", a ZIP package with nested folders, or a public GitHub repository. The name and description are read from the skill entry when available.")}</p>
<SegmentedControl className="skill-install-mode" block options={modeOptions.map((option) => option.value === "zip" ? { ...option, label: <span className="inline-flex items-center gap-1.5"><FileArchive className="size-3.5" />{text("ZIP 技能包", "ZIP package")}</span> } : option)} value={mode} onChange={(value) => { setMode(value as InstallMode); setFileList([]); }} />

            <Form form={form} layout="vertical" requiredMark="optional" className="skill-install-form">
                {mode === "github" ? (
                    <>
                        <Form.Item name="url" label={text("GitHub 地址", "GitHub URL")} rules={[{ required: true, message: text("请填写 GitHub 仓库地址", "Enter a GitHub repository URL") }, { type: "url", message: text("请输入有效链接", "Enter a valid URL") }]}>
                            <Input type="url" inputMode="url" spellCheck={false} prefix={<GitBranch className="size-4 text-foreground/35" />} placeholder="https://github.com/owner/repository" />
                        </Form.Item>
                        <div className="grid gap-x-3 sm:grid-cols-2">
                            <Form.Item name="ref" label={text("分支或标签", "Branch or tag")} extra={text("留空时使用默认分支", "Leave blank for the default branch")}><Input spellCheck={false} placeholder="main" /></Form.Item>
                            <Form.Item name="subdir" label={text("技能子目录", "Skill subdirectory")} extra={text("仓库仅含一个技能时可留空", "Optional if the repository contains one skill")}><Input spellCheck={false} placeholder="skills/ai-director" /></Form.Item>
                        </div>
                    </>
                ) : (
                    <>
                        <Upload.Dragger
                            accept={mode === "zip" ? ".zip,application/zip" : ".md,.markdown,text/markdown"}
                            maxCount={1}
                            fileList={fileList}
                            beforeUpload={(file) => {
                                if (file.size > 20 * 1024 * 1024) {
                                    message.error(text("技能文件不能超过 20MB", "Skill file must be under 20 MB"));
                                    return Upload.LIST_IGNORE;
                                }
                                return false;
                            }}
                            onChange={({ fileList: next }) => setFileList(next.slice(-1))}
                            onRemove={() => { setFileList([]); return true; }}
                        >
                            <UploadCloud className="mx-auto mb-3 size-8 text-foreground/38" />
                            <div className="text-sm font-medium">{text("拖入或选择", "Drop or select")} {mode === "zip" ? text("ZIP 技能包", "ZIP package") : text("Markdown 文件", "Markdown file")}</div>
                            <div className="mt-1 text-xs text-foreground/45">{mode === "zip" ? text("根目录或唯一子目录中必须包含 SKILL.md", "The root or sole subdirectory must contain SKILL.md") : text("普通 .md 会作为技能入口 SKILL.md 安装", "A regular .md file will be installed as SKILL.md")}</div>
                        </Upload.Dragger>
                        <div className="mt-4 grid gap-x-3 sm:grid-cols-2">
                            <Form.Item name="name" label={text("覆盖名称", "Override name")} extra={text("可选，留空时自动读取", "Optional; read automatically when blank")}><Input maxLength={80} autoComplete="off" /></Form.Item>
                            <Form.Item name="description" label={text("覆盖简介", "Override description")} extra={text("可选，留空时自动读取", "Optional; read automatically when blank")}><Input maxLength={500} autoComplete="off" /></Form.Item>
                        </div>
                    </>
                )}

                <div className="grid gap-x-3 sm:grid-cols-2">
                    <Form.Item name="tag" label={text("技能分类", "Skill category")} rules={[{ required: true, message: text("请选择技能分类", "Select a skill category") }]}>
                        <Select options={fallbackSkillCategories.map((item) => ({ ...item, label: skillCategoryLabel(item.value, fallbackSkillCategories, locale) }))} />
                    </Form.Item>
                    <Form.Item name="is_public" label={text("公开状态", "Visibility")} valuePropName="checked" extra={text("公开后其他用户可以加入使用。", "Other users can add public skills.")}>
                        <Switch checkedChildren={text("公开", "Public")} unCheckedChildren={text("私有", "Private")} />
                    </Form.Item>
                </div>
                {mode === "github" ? <Form.Item name="autoUpdate" label={text("自动同步", "Automatic sync")} valuePropName="checked" extra={text("后台每 6 小时检查一次提交版本，并记录最近检查与同步时间。", "Checks for new commits every six hours and records sync activity.")}><Switch checkedChildren={text("开启", "On")} unCheckedChildren={text("关闭", "Off")} /></Form.Item> : null}
            </Form>
        </Modal>
    );
}
