import { App, Button, Form, Input } from "antd";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/components/ui/base/switch";
import { Minus, Plus, Save, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { fallbackSkillCategories, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { generateSkillDraft } from "@/lib/canvas/skill-drafting";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { createSkill, updateSkill, type Skill, type SkillMutationInput, type SkillShowcaseMedia } from "@/services/api/skills";

type SkillFormValues = Omit<SkillMutationInput, "isPrivate"> & { is_public: boolean };

export function SkillEditorDrawer({ open, skill, onClose, onSaved }: { open: boolean; skill: Skill | null; onClose: () => void; onSaved: (skill: Skill) => void }) {
    const { locale, text } = useLocaleText();
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<SkillFormValues>();
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftIdea, setDraftIdea] = useState("");
    const [drafting, setDrafting] = useState(false);
    const effectiveConfig = useEffectiveConfig();
    const isPackageSkill = Boolean(skill && skill.sourceType !== "markdown" && skill.sourceType !== "builtin" && skill.sourceType !== "");

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            skillName: skill?.skillName || "",
            description: skill?.description || "",
            instruction: skill?.instruction || "",
            tag: skill?.tag || "creative",
            is_public: skill ? !skill.isPrivate : true,
            markdownUrl: skill?.markdownUrl || skill?.sourceUrl || "",
            showcaseMedia: skill?.showcaseMedia || [],
            extraInfo: skill?.extraInfo || "",
        });
        setDirty(false);
    }, [form, open, skill]);

    const requestClose = () => {
        if (!dirty) {
            onClose();
            return;
        }
        modal.confirm({ title: text("放弃未保存的修改？", "Discard unsaved changes?"), content: text("当前填写内容不会保留。", "The content you entered will be lost."), okText: text("放弃修改", "Discard changes"), okButtonProps: { danger: true }, cancelText: text("继续编辑", "Keep editing"), onOk: onClose });
    };

    const submit = async (values: SkillFormValues) => {
        setSaving(true);
        try {
            const input: SkillMutationInput = {
                skillName: values.skillName,
                description: values.description,
                instruction: values.instruction || "",
                tag: values.tag,
                isPrivate: !values.is_public,
                markdownUrl: values.markdownUrl || "",
                showcaseMedia: (values.showcaseMedia || []).map((item) => ({ ...item, showcaseUri: item.showcaseUri || "" })),
                extraInfo: values.extraInfo || "",
            };
            const result = skill ? await updateSkill(skill.skillId, input) : await createSkill(input);
            setDirty(false);
            message.success(skill ? text("技能已更新", "Skill updated") : text("技能已创建", "Skill created"));
            onSaved(result.skill);
        } catch (error) {
            message.error(localizedErrorMessage(error, "技能保存失败", "Could not save skill", locale));
        } finally {
            setSaving(false);
        }
    };

    const draftFromIdea = async () => {
        const idea = draftIdea.trim();
        if (!idea) {
            message.warning(text("请先描述你想沉淀的技能", "Describe the skill you want to create"));
            return;
        }
        if (!useConfigStore.getState().isAiConfigReady(effectiveConfig, effectiveConfig.model)) {
            message.info(text("尚未配置可用的文本模型，请先到设置页配置", "No text model is available. Configure one in Settings first."));
            navigateToSettings({ section: "models", continueCreation: true });
            return;
        }
        setDrafting(true);
        try {
            const draft = await generateSkillDraft(idea, effectiveConfig);
            form.setFieldsValue({
                skillName: draft.skillName || "",
                description: draft.description || "",
                instruction: draft.instruction || "",
                ...(draft.tag ? { tag: draft.tag } : {}),
            });
            setDirty(true);
            message.success(text("草稿已生成，请检查并调整后保存", "Draft generated. Review and edit it before saving."));
        } catch (error) {
            message.error(localizedErrorMessage(error, "起草失败", "Could not generate a draft", locale));
        } finally {
            setDrafting(false);
        }
    };

    return (
        <AppDrawer className="library-drawer" open={open} size={720} mask={{ closable: !dirty }} title={skill ? text("编辑技能", "Edit skill") : text("创建技能", "Create skill")} onClose={requestClose} extra={<Button type="primary" loading={saving} icon={<Save className="size-4" />} onClick={() => form.submit()}>{text("保存技能", "Save skill")}</Button>}>
            {!isPackageSkill ? <div className="mb-4 rounded-xl border bg-foreground/[.02] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <Wand2 className="size-4" />
                    {text("AI 起草", "AI draft")}
                    <span className="font-normal text-foreground/45">{text("描述想法，一键生成名称、简介与指令草稿（可再编辑）", "Describe an idea to generate an editable name, description, and instructions.")}</span>
                </div>
                <Input.TextArea
                    value={draftIdea}
                    onChange={(event) => setDraftIdea(event.target.value)}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    maxLength={2000}
                    showCount
                    disabled={drafting}
                    placeholder={text("例如：我要一个竖屏短剧分镜技能——输入剧本段落，输出按景别排列的分镜表，每个镜头包含画面、台词、时长与转场…", "For example: Create a short drama storyboard skill that turns a script into shots with framing, dialogue, duration, and transitions.")}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground/45">{text("将使用你的文本模型生成一次草稿", "Uses your text model to generate a draft")}</span>
                    <Button type="primary" loading={drafting} disabled={!draftIdea.trim()} icon={<Wand2 className="size-4" />} onClick={() => void draftFromIdea()}>{text("生成草稿", "Generate draft")}</Button>
                </div>
            </div> : <div className="mb-4 rounded-xl border bg-foreground/[.02] p-3 text-sm leading-6 text-foreground/58">{text("这是多文件技能包。这里仅编辑名称、简介、分类和展示信息；技能正文请更新 ZIP，或在 GitHub 仓库修改后执行同步。", "This is a multi-file skill package. Edit its name, description, category, and display details here. Update the ZIP or sync GitHub to change the skill files.")}</div>}
            <Form form={form} layout="vertical" requiredMark="optional" onFinish={submit} onValuesChange={() => setDirty(true)}>
                <div className="grid gap-x-4 sm:grid-cols-2">
                    <Form.Item name="skillName" label={text("技能名称", "Skill name")} rules={[{ required: true, message: text("请填写技能名称", "Enter a skill name") }, { max: 80, message: text("最多 80 个字符", "Maximum 80 characters") }]}>
                        <Input maxLength={80} showCount placeholder={text("例如：短剧导演分镜", "For example: Short drama storyboard director")} autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="tag" label={text("技能分类", "Skill category")} rules={[{ required: true, message: text("请选择技能分类", "Select a skill category") }]}>
                        <Select options={fallbackSkillCategories.map(({ value }) => ({ value, label: skillCategoryLabel(value, fallbackSkillCategories, locale) }))} />
                    </Form.Item>
                </div>

                <Form.Item name="description" label={text("技能简介", "Skill description")} rules={[{ required: true, message: text("请填写技能简介", "Enter a skill description") }, { max: 500, message: text("最多 500 个字符", "Maximum 500 characters") }]}>
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={500} showCount placeholder={text("说明适用场景、输入条件和最终产出", "Describe use cases, inputs, and expected outputs")} />
                </Form.Item>

                {!isPackageSkill ? <Form.Item name="instruction" label={text("技能指令", "Skill instructions")} rules={[{ required: true, message: text("请填写技能指令", "Enter skill instructions") }, { max: 100000, message: text("最多 100000 个字符", "Maximum 100,000 characters") }]} extra={text("单文件技能会作为 SKILL.md 安装，Agent 按任务需要读取。", "Single-file skills are installed as SKILL.md for the Agent to read when needed.")}>
                    <Input.TextArea className="font-mono text-xs leading-5" autoSize={{ minRows: 14, maxRows: 28 }} maxLength={100000} showCount placeholder={text("使用 Markdown 编写角色、约束、流程、检查清单和输出格式", "Use Markdown for roles, constraints, steps, checklists, and output format")} />
                </Form.Item> : null}

                <div className="grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <Form.Item name="markdownUrl" label={isPackageSkill ? text("来源地址", "Source URL") : text("Markdown 地址", "Markdown URL")} rules={[{ type: "url", message: text("请输入有效的 HTTP(S) 链接", "Enter a valid HTTP(S) URL") }]}>
                        <Input type="url" inputMode="url" spellCheck={false} placeholder="https://example.com/SKILL.md" />
                    </Form.Item>
                    <Form.Item name="is_public" label={text("公开状态", "Visibility")} valuePropName="checked" extra={text("公开后其他用户可以加入使用。", "Other users can add public skills.")}>
                        <Switch checkedChildren={text("公开", "Public")} unCheckedChildren={text("私有", "Private")} />
                    </Form.Item>
                </div>

                <Form.List name="showcaseMedia">
                    {(fields, { add, remove }) => (
                        <section aria-labelledby="skill-media-title">
                            <div className="mb-3 flex items-center justify-between">
                                <div><h3 id="skill-media-title" className="text-sm font-medium">{text("展示媒体", "Showcase media")}</h3><p className="mt-1 text-xs text-foreground/50">{text("可选，最多 8 个公开图片或视频链接。", "Optional; up to eight public image or video URLs.")}</p></div>
                                <Button disabled={fields.length >= 8} icon={<Plus className="size-4" />} onClick={() => add(emptyMedia())}>{text("添加媒体", "Add media")}</Button>
                            </div>
                            <div className="space-y-2">
                                {fields.map((field) => (
                                    <div key={field.key} className="grid grid-cols-[112px_minmax(0,1fr)_36px] gap-2">
                                        <Form.Item {...field} name={[field.name, "type"]} className="mb-0" rules={[{ required: true, message: text("选择类型", "Select a type") }]}>
                                            <Select options={[{ value: "image", label: text("图片", "Image") }, { value: "video", label: text("视频", "Video") }]} />
                                        </Form.Item>
                                        <Form.Item {...field} name={[field.name, "showcaseUrl"]} className="mb-0" rules={[{ required: true, message: text("请填写媒体链接", "Enter a media URL") }, { type: "url", message: text("链接格式无效", "Invalid URL") }]}>
                                            <Input type="url" inputMode="url" spellCheck={false} placeholder="https://example.com/media" />
                                        </Form.Item>
                                        <Button aria-label={text("移除媒体", "Remove media")} title={text("移除媒体", "Remove media")} icon={<Minus className="size-4" />} onClick={() => remove(field.name)} />
                                        <Form.Item {...field} name={[field.name, "showcaseUri"]} hidden><Input /></Form.Item>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </Form.List>

                <Form.Item name="extraInfo" label={text("补充信息", "Additional information")} className="mt-5" rules={[{ max: 2000, message: text("最多 2000 个字符", "Maximum 2,000 characters") }]}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} showCount placeholder={text("版本说明、依赖工具或使用注意事项", "Version notes, dependencies, or usage tips")} />
                </Form.Item>
            </Form>
        </AppDrawer>
    );
}

function emptyMedia(): SkillShowcaseMedia {
    return { type: "image", showcaseUri: "", showcaseUrl: "" };
}
