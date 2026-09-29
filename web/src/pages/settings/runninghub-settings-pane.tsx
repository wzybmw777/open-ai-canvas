import { App, AutoComplete, Button, Form, Input, Popconfirm } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { Select } from "@/components/ui/base/select";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { WorkflowFieldMappingEditor } from "@/components/workflow-field-mapping-editor";
import { WorkflowGraphEditor } from "@/components/workflow-graph-editor";
import { WorkflowTestWorkbench } from "@/components/workflow-test-workbench";
import { localizedErrorMessage, useLocaleText, type AppLocale } from "@/lib/i18n";
import { fetchRunningHubApp, fetchRunningHubWorkflow } from "@/services/api/runninghub";
import {
    normalizeRunningHubCapability,
    normalizeRunningHubWorkflowKind,
    mergeWorkflowFieldMappings,
    normalizeWorkflowFieldMappings,
    useConfigStore,
    type RunningHubCapability,
    type RunningHubConfig,
    type RunningHubWorkflow,
    type RunningHubWorkflowKind,
    type WorkflowFieldMapping,
} from "@/stores/use-config-store";

const capabilityOptions = [
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

function workflowCapability(workflow: RunningHubWorkflow | undefined, fallback: RunningHubCapability): RunningHubCapability {
    return normalizeRunningHubCapability(workflow?.capability, normalizeRunningHubCapability(fallback));
}

function workflowKind(workflow: RunningHubWorkflow | undefined): RunningHubWorkflowKind {
    return normalizeRunningHubWorkflowKind(workflow?.kind);
}

function workflowEntryKey(workflow: RunningHubWorkflow): string {
    return `${workflowKind(workflow)}:${workflow.workflowId.trim()}`;
}

function capabilityLabel(capability: RunningHubCapability, locale: AppLocale) {
    return locale === "en-US" ? (capability === "video" ? "Video" : capability === "audio" ? "Audio" : "Image") : capability === "video" ? "视频" : capability === "audio" ? "音频" : "图片";
}

function workflowNeedsMediaUpload(fields: WorkflowFieldMapping[]) {
    return fields.some((field) => {
        const source = String(field.source || "")
            .trim()
            .toLowerCase();
        const fieldType = String(field.fieldType || "")
            .trim()
            .toUpperCase();
        return ["referenceimage", "referencevideo", "referenceaudio", "mask"].includes(source) || ["IMAGE", "VIDEO", "AUDIO"].includes(fieldType);
    });
}

export function RunningHubSettingsPane() {
    const { locale, text } = useLocaleText();
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const runningHub = config.runningHub;
    const selected = runningHub.workflows.find((item) => item.workflowId.trim() === runningHub.workflowId.trim() && workflowKind(item) === runningHub.selectedKind);
    const selectedKey = selected ? workflowEntryKey(selected) : undefined;
    const [draftId, setDraftId] = useState(selected?.workflowId || "");
    const [workflowText, setWorkflowText] = useState(selected?.workflowJson ? JSON.stringify(selected.workflowJson, null, 2) : "");
    const [kind, setKind] = useState<RunningHubWorkflowKind>(selected ? workflowKind(selected) : runningHub.selectedKind);
    const [title, setTitle] = useState(selected?.title || "");
    const [capability, setCapability] = useState<RunningHubCapability>(workflowCapability(selected, runningHub.capability));
    const [fetching, setFetching] = useState(false);
    const [workspaceMode, setWorkspaceMode] = useState<"fields" | "test">("fields");

    useEffect(() => {
        if (!selected) return;
        setDraftId(selected.workflowId);
        setWorkflowText(selected.workflowJson ? JSON.stringify(selected.workflowJson, null, 2) : "");
        setKind(workflowKind(selected));
        setTitle(selected.title || "");
        setCapability(workflowCapability(selected, runningHub.capability));
    }, [selectedKey, selected?.workflowJson, selected?.title, selected?.capability, runningHub.capability]);

    const update = (patch: Partial<RunningHubConfig>) => updateConfig("runningHub", { ...runningHub, ...patch });
    const draftMatchesSelected = Boolean(selected && workflowEntryKey(selected) === `${kind}:${draftId.trim()}`);

    const persistWorkflow = (workflow: RunningHubWorkflow, nextCapability = capability) => {
        const workflowId = workflow.workflowId.trim();
        if (!workflowId) return;
        const nextKind = workflowKind(workflow);
        const next: RunningHubWorkflow = {
            ...workflow,
            kind: nextKind,
            workflowId,
            capability: normalizeRunningHubCapability(nextCapability, capability),
            fields: normalizeWorkflowFieldMappings(workflow.fields, normalizeRunningHubCapability(nextCapability, capability)),
        };
        if (nextKind === "app") {
            // AI 应用只保存其公开参数，绝不能继续携带之前 Workflow 的 JSON。
            delete next.workflowJson;
            next.webappId = (next.webappId || workflowId).trim();
        } else {
            delete next.webappId;
        }
        const nextKey = workflowEntryKey(next);
        update({
            workflowId,
            selectedKind: nextKind,
            capability: next.capability || capability,
            workflows: [...runningHub.workflows.filter((item) => workflowEntryKey(item) !== nextKey), next],
        });
    };

    const fetchWorkflow = async () => {
        const id = draftId.trim();
        if (!id) return message.warning(kind === "app" ? text("请先填写 webappId", "Enter webappId first") : text("请先填写 workflowId", "Enter workflowId first"));
        if (!runningHub.apiKey.trim()) return message.warning(text("请先填写积分 API Key", "Enter a credit API Key first"));
        setFetching(true);
        try {
            // 管理接口只接受拉取参数所需的小请求，不能把已保存工作流及大段 JSON 一并提交。
            const fetchConfig = {
                baseUrl: runningHub.baseUrl,
                apiKey: runningHub.apiKey,
                walletApiKey: "",
                useWallet: false,
                title: title.trim(),
                capability,
            };
            const result = kind === "app" ? await fetchRunningHubApp({ ...fetchConfig, webappId: id }) : await fetchRunningHubWorkflow({ ...fetchConfig, workflowId: id });
            const existing = runningHub.workflows.find((workflow) => workflowEntryKey(workflow) === `${kind}:${id}`);
            const item: RunningHubWorkflow = {
                ...result,
                kind,
                workflowId: id,
                webappId: kind === "app" ? result.webappId || id : undefined,
                title: result.title || title.trim() || id,
                fields: existing ? mergeWorkflowFieldMappings(existing.fields, result.fields, capability) : normalizeWorkflowFieldMappings(result.fields, capability),
                workflowJson: kind === "workflow" ? result.workflowJson || {} : undefined,
            };
            persistWorkflow(item, capability);
            setWorkflowText(item.workflowJson ? JSON.stringify(item.workflowJson, null, 2) : "");
            setTitle(item.title || "");
            message.success(
                locale === "en-US"
                    ? workflowNeedsMediaUpload(item.fields || [])
                        ? "RunningHub parameters saved. Generation will upload reference media."
                        : "RunningHub parameters fetched and saved."
                    : workflowNeedsMediaUpload(item.fields || [])
                      ? `${kind === "app" ? "RunningHub App" : "RunningHub 工作流"}参数已保存；生成时会调用 RunningHub 素材上传接口`
                      : `${kind === "app" ? "RunningHub App" : "RunningHub 工作流"}参数已重新拉取并保存`,
            );
        } catch (error) {
            message.error(localizedErrorMessage(error, "拉取 RunningHub 参数失败", "Could not fetch RunningHub parameters", locale));
        } finally {
            setFetching(false);
        }
    };

    const removeWorkflow = (workflow: RunningHubWorkflow) => {
        const targetKey = workflowEntryKey(workflow);
        const remaining = runningHub.workflows.filter((item) => workflowEntryKey(item) !== targetKey);
        update({ workflowId: "", selectedKind: workflowKind(workflow), workflows: remaining });
        setDraftId("");
        setWorkflowText("");
        setTitle("");
        message.success(
            locale === "en-US" ? `Deleted ${workflowKind(workflow) === "app" ? "App" : "Workflow"}: ${workflow.title || workflow.workflowId}` : `已删除${workflowKind(workflow) === "app" ? " App" : " Workflow"}：${workflow.title || workflow.workflowId}`,
        );
    };

    const updateCapability = (value: RunningHubCapability) => {
        const nextCapability = normalizeRunningHubCapability(value, capability);
        setCapability(nextCapability);
        if (selected && draftMatchesSelected) persistWorkflow({ ...selected, capability: nextCapability }, nextCapability);
    };

    const selectWorkflow = (entryKey: string | undefined) => {
        if (!entryKey) {
            update({ workflowId: "" });
            setDraftId("");
            setWorkflowText("");
            setTitle("");
            return;
        }
        const workflow = runningHub.workflows.find((item) => workflowEntryKey(item) === entryKey);
        if (!workflow) return message.error(text("已保存条目不存在，请刷新页面后重试", "Saved item not found. Refresh and try again."));
        const nextCapability = workflowCapability(workflow, runningHub.capability);
        update({ workflowId: workflow.workflowId.trim(), selectedKind: workflowKind(workflow), capability: nextCapability });
        setDraftId(workflow.workflowId.trim());
        setWorkflowText(workflow.workflowJson ? JSON.stringify(workflow.workflowJson, null, 2) : "");
        setKind(workflowKind(workflow));
        setTitle(workflow.title || "");
        setCapability(nextCapability);
    };

    const changeKind = (nextKind: RunningHubWorkflowKind) => {
        setKind(nextKind);
        setDraftId("");
        setWorkflowText("");
        setTitle("");
        update({ workflowId: "", selectedKind: nextKind });
    };

    const updateWorkflowJson = (value: string) => {
        if (kind === "app") return;
        if (!selected || !draftMatchesSelected) return message.warning(text("请先拉取或选择要编辑的 Workflow", "Fetch or select a Workflow to edit"));
        try {
            const parsed = value.trim() ? JSON.parse(value) : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(text("工作流 JSON 必须是对象", "Workflow JSON must be an object"));
            persistWorkflow({ ...selected, title: title.trim() || selected.title, workflowJson: parsed });
        } catch (error) {
            message.error(error instanceof SyntaxError ? text("工作流 JSON 格式无效", "Invalid workflow JSON") : localizedErrorMessage(error, "工作流 JSON 格式无效", "Invalid workflow JSON", locale));
        }
    };

    const updateWorkflowFields = (fields: WorkflowFieldMapping[]) => {
        if (!selected || !draftMatchesSelected) return;
        persistWorkflow({ ...selected, title: title.trim() || selected.title, fields });
    };

    const updateTitle = () => {
        if (!selected || !draftMatchesSelected) return;
        persistWorkflow({ ...selected, title: title.trim() || selected.workflowId });
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>{text("RunningHub 工作流", "RunningHub workflows")}</h2>
                    <p>{text("独立于系统渠道配置。工作流提交使用积分 API Key，参考素材上传使用企业级 API Key。", "Workflows use a credit API Key for jobs and an enterprise API Key for reference uploads.")}</p>
                </div>
                <Switch checked={runningHub.enabled} checkedChildren={text("启用", "On")} unCheckedChildren={text("停用", "Off")} onChange={(enabled) => update({ enabled })} />
            </div>
            <div className="settings-section grid gap-3 lg:grid-cols-12">
                <Form.Item label="Base URL" className="mb-0 lg:col-span-6">
                    <AutoComplete
                        className="w-full"
                        value={runningHub.baseUrl}
                        options={[
                            { label: text("中国站 · https://www.runninghub.cn", "China · https://www.runninghub.cn"), value: "https://www.runninghub.cn" },
                            { label: text("国际站 · https://www.runninghub.ai", "International · https://www.runninghub.ai"), value: "https://www.runninghub.ai" },
                        ]}
                        onChange={(baseUrl) => update({ baseUrl })}
                        onBlur={() => update({ baseUrl: runningHub.baseUrl.trim().replace(/\/+$/, "") })}
                    >
                        <Input placeholder={text("选择官方站点或填写兼容网关地址", "Select a site or enter a compatible gateway URL")} />
                    </AutoComplete>
                </Form.Item>
                <Form.Item
                    label={text("积分 API Key（工作流提交）", "Credit API Key (workflow jobs)")}
                    className="mb-0 lg:col-span-6"
                    extra={text(
                        "用于拉取工作流参数、创建任务和查询结果；最终提交固定使用这把 Key。若提示企业版余额不足，请检查这里没有填企业级上传 Key。",
                        "Used to fetch parameters, create jobs, and check results. Do not enter the enterprise upload key here.",
                    )}
                >
                    <Input.Password autoComplete="new-password" value={runningHub.apiKey} onChange={(event) => update({ apiKey: event.target.value })} />
                </Form.Item>
                <Form.Item
                    label={text("素材上传 API Key（企业级）", "Media upload API Key (enterprise)")}
                    className="mb-0 lg:col-span-6"
                    extra={text("仅用于上传参考图片、视频、音频和蒙版；没有参考素材时可以留空。", "Only used for reference images, video, audio, and masks. Leave blank when not needed.")}
                >
                    <Input.Password autoComplete="new-password" value={runningHub.uploadApiKey || ""} onChange={(event) => update({ uploadApiKey: event.target.value })} />
                </Form.Item>
                <Form.Item label={text("工作流用途", "Workflow purpose")} className="mb-0 lg:col-span-6">
                    <Select
                        className="w-full"
                        value={capability}
                        options={capabilityOptions.map((option) => ({ ...option, label: capabilityLabel(option.value as RunningHubCapability, locale) }))}
                        onChange={(value) => updateCapability(value as RunningHubCapability)}
                    />
                </Form.Item>
                <Form.Item label={text("已保存条目", "Saved items")} className="mb-0 lg:col-span-6">
                    <Select
                        className="w-full"
                        allowClear
                        value={selectedKey}
                        options={runningHub.workflows.map((item) => ({
                            label: `${workflowKind(item) === "app" ? "App" : "Workflow"} · ${item.title || item.workflowId} · ${capabilityLabel(workflowCapability(item, runningHub.capability), locale)}`,
                            value: workflowEntryKey(item),
                        }))}
                        placeholder={text("选择已保存 Workflow / App", "Select a saved Workflow or App")}
                        onChange={selectWorkflow}
                    />
                </Form.Item>
                <Form.Item label={text("类型", "Type")} className="mb-0 lg:col-span-3">
                    <SegmentedControl
                        block
                        value={kind}
                        options={[
                            { label: "Workflow", value: "workflow" },
                            { label: "App", value: "app" },
                        ]}
                        onChange={(value) => changeKind(value as RunningHubWorkflowKind)}
                    />
                </Form.Item>
                <Form.Item label={kind === "app" ? "webappId" : "workflowId"} className="mb-0 lg:col-span-3">
                    <Input value={draftId} placeholder={kind === "app" ? "RunningHub webappId" : "RunningHub workflowId"} onChange={(event) => setDraftId(event.target.value)} />
                </Form.Item>
                <Form.Item label={text("显示名称", "Display name")} className="mb-0 lg:col-span-6">
                    <Input value={title} placeholder={text("可选", "Optional")} onChange={(event) => setTitle(event.target.value)} onBlur={updateTitle} />
                </Form.Item>
                <Form.Item label={text("操作", "Actions")} className="workflow-entry-actions-field mb-0 lg:col-span-6">
                    <div className="workflow-entry-actions">
                        <Button type="primary" icon={<RefreshCw className="size-4" />} loading={fetching} onClick={() => void fetchWorkflow()}>
                            {text("拉取参数", "Fetch parameters")}
                        </Button>
                        <Popconfirm
                            title={text("删除当前条目？", "Delete this item?")}
                            description={selected ? `${workflowKind(selected) === "app" ? "App" : "Workflow"} · ${selected.title || selected.workflowId}` : undefined}
                            okText={text("删除", "Delete")}
                            cancelText={text("取消", "Cancel")}
                            onConfirm={() => selected && removeWorkflow(selected)}
                        >
                            <Button danger icon={<Trash2 className="size-4" />} disabled={!selected}>
                                {text("删除", "Delete")}
                            </Button>
                        </Popconfirm>
                    </div>
                </Form.Item>
                <div className="workflow-workspace-tabs lg:col-span-12">
                    <SegmentedControl
                        block
                        value={workspaceMode}
                        options={[
                            { label: text("字段配置", "Fields"), value: "fields" },
                            { label: text("测试画布", "Test workspace"), value: "test" },
                        ]}
                        onChange={(value) => setWorkspaceMode(value as "fields" | "test")}
                    />
                </div>
                {workspaceMode === "fields" && kind === "workflow" ? (
                    <>
                        <div className="lg:col-span-12">
                            <WorkflowGraphEditor
                                workflowJson={selected?.workflowJson}
                                fields={selected?.fields || []}
                                disabled={!selected || !draftMatchesSelected}
                                onChange={updateWorkflowFields}
                                emptyDescription={text("请先拉取 RunningHub Workflow", "Fetch a RunningHub Workflow first")}
                            />
                        </div>
                        <details className="workflow-json-details lg:col-span-12">
                            <summary>{text("查看或编辑 ComfyUI API JSON", "View or edit ComfyUI API JSON")}</summary>
                            <Form.Item
                                className="mb-0 mt-3"
                                extra={text("RunningHub Workflow 与 ComfyUI 共用同一种拓扑解析合同；修改 JSON 后移出输入框即保存。", "RunningHub Workflows use the ComfyUI graph format. Changes save when you leave the field.")}
                            >
                                <Input.TextArea
                                    rows={12}
                                    value={workflowText}
                                    spellCheck={false}
                                    placeholder={'{"3":{"class_type":"...","inputs":{}}}'}
                                    onChange={(event) => setWorkflowText(event.target.value)}
                                    onBlur={() => updateWorkflowJson(workflowText)}
                                />
                            </Form.Item>
                        </details>
                    </>
                ) : null}
                {workspaceMode === "fields" && kind === "app" ? (
                    <Form.Item
                        label={text("App 公开参数映射", "App public parameter mapping")}
                        className="mb-0 lg:col-span-12"
                        extra={text("AI 应用不返回完整 ComfyUI 拓扑，只能编辑当前发布版本的公开参数；应用更新后请再次点击“拉取参数”。", "Apps expose public parameters instead of a full ComfyUI graph. Fetch parameters again after an app update.")}
                    >
                        <WorkflowFieldMappingEditor fields={selected?.fields || []} disabled={!selected || !draftMatchesSelected} onChange={updateWorkflowFields} />
                    </Form.Item>
                ) : null}
                {workspaceMode === "test" ? (
                    <div className="lg:col-span-12">
                        <WorkflowTestWorkbench
                            key={`runninghub:${selectedKey || "empty"}`}
                            provider="runninghub"
                            workflowId={selected?.workflowId || ""}
                            workflowKind={selected ? workflowKind(selected) : kind}
                            title={selected?.title || title || draftId}
                            capability={selected ? workflowCapability(selected, capability) : capability}
                            fields={selected?.fields || []}
                            disabled={!selected || !draftMatchesSelected || !runningHub.baseUrl.trim() || !runningHub.apiKey.trim()}
                            disabledReason={
                                !selected || !draftMatchesSelected
                                    ? text("请先拉取或选择一个已保存的 RunningHub 条目", "Fetch or select a saved RunningHub item")
                                    : !runningHub.baseUrl.trim()
                                      ? text("请先填写 RunningHub Base URL", "Enter a RunningHub Base URL")
                                      : text("请先填写积分 API Key", "Enter a credit API Key")
                            }
                        />
                    </div>
                ) : null}
            </div>
        </Form>
    );
}

export function runningHubWorkflow(config: RunningHubConfig): RunningHubWorkflow | undefined {
    const workflowId = config.workflowId.trim();
    return config.workflows.find((item) => item.workflowId.trim() === workflowId && workflowKind(item) === config.selectedKind);
}
