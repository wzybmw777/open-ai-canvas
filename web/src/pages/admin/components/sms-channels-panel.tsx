import { App, Button, Form, Input, InputNumber, Table } from "antd";
import { MessageSquare, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { createSMSChannel, deleteSMSChannel, listSMSChannels, listSMSRecords, testSMSChannel, updateSMSChannel, type SMSChannel, type SMSChannelInput, type SMSRecord } from "@/services/api/sms";
import type { VerificationPurpose } from "@/services/api/verification";
import { Callout, Select, Switch } from "../ui/controls";
import { AdminDrawer, AdminModal } from "../ui/overlays";
import { AdminStatusBadge, AdminTableEmpty, PaginationBar, SettingsSectionCard, configuredSecretText } from "./admin-ui";

const purposes: Array<{ value: VerificationPurpose; label: string }> = [
    { value: "login", label: "登录" },
    { value: "register", label: "注册" },
    { value: "bind", label: "绑定手机号" },
];
const purposeLabels = { login: "登录", register: "注册", bind: "绑定手机号" };
const providers = [
    { value: "aliyun", label: "阿里云" },
    { value: "tencent", label: "腾讯云" },
    { value: "huyi", label: "互亿无线" },
];
const stateLabels: Record<string, string> = { accepted: "已受理", rejected: "已拒绝", unknown: "受理状态未知" };

export default function SMSChannelsPanel({ onUnsavedChange }: { onUnsavedChange: (dirty: boolean) => void }) {
    const { message, modal } = App.useApp();
    const [channels, setChannels] = useState<SMSChannel[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<SMSChannel | "new" | null>(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [form] = Form.useForm<SMSChannelInput>();
    const provider = Form.useWatch("provider", form);
    const orderedParameters = provider === "tencent" || provider === "huyi";
    const version = useRef(0);
    const mutation = useRef(false);

    const [records, setRecords] = useState<SMSRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [recordsLoading, setRecordsLoading] = useState(false);
    const [recordsError, setRecordsError] = useState("");
    const [recordsReload, setRecordsReload] = useState(0);
    const [testChannel, setTestChannel] = useState<SMSChannel | null>(null);
    const [testPhone, setTestPhone] = useState("");
    const [testPurpose, setTestPurpose] = useState<VerificationPurpose>("register");
    const [testing, setTesting] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const testInFlight = useRef(false);

    useEffect(() => {
        onUnsavedChange(dirty || saving);
    }, [dirty, saving, onUnsavedChange]);
    useEffect(() => () => onUnsavedChange(false), [onUnsavedChange]);
    useEffect(() => {
        if (!cooldown) return;
        const timer = window.setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [cooldown]);

    const load = useCallback(async () => {
        const request = ++version.current;
        setLoading(true);
        setError("");
        try {
            const result = await listSMSChannels();
            if (request === version.current) setChannels(result);
        } catch (err) {
            if (request === version.current) setError(err instanceof Error ? err.message : "读取短信渠道失败");
        } finally {
            if (request === version.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load();
        return () => {
            version.current++;
        };
    }, [load]);
    useEffect(() => {
        const controller = new AbortController();
        setRecordsLoading(true);
        setRecordsError("");
        void listSMSRecords({ page, pageSize: 10 }, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setRecords(result.items);
                setTotal(result.total);
            })
            .catch((err) => {
                if (!controller.signal.aborted) setRecordsError(err instanceof Error ? err.message : "读取发送记录失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setRecordsLoading(false);
            });
        return () => controller.abort();
    }, [page, recordsReload]);

    const openEditor = (channel: SMSChannel | "new") => {
        form.resetFields();
        form.setFieldsValue(
            channel === "new"
                ? {
                      name: "",
                      provider: "aliyun",
                      enabled: false,
                      priority: 100,
                      dailyLimit: 100,
                      signName: "",
                      appId: "",
                      accessId: "",
                      accessKey: "",
                      version: 0,
                      templates: [{ purpose: "register", templateId: "", parameters: [{ name: "code", value: "code" }] }],
                  }
                : { ...channel, accessId: "", accessKey: "" },
        );
        setDirty(false);
        setEditing(channel);
    };
    const closeEditor = () => {
        if (mutation.current) return;
        const close = () => {
            setEditing(null);
            setDirty(false);
            form.resetFields();
        };
        if (!dirty) close();
        else modal.confirm({ title: "放弃短信渠道调整？", content: "未保存的模板和凭据将丢失。", okText: "放弃调整", cancelText: "继续编辑", onOk: close });
    };
    const save = async () => {
        if (!editing || mutation.current) return;
        mutation.current = true;
        let values: SMSChannelInput;
        try {
            values = await form.validateFields();
        } catch {
            mutation.current = false;
            return;
        }
        setSaving(true);
        try {
            const input = { ...values, name: values.name.trim(), signName: provider === "huyi" ? "" : values.signName?.trim() || "", version: editing === "new" ? 0 : editing.version, appId: provider === "tencent" ? values.appId?.trim() || "" : "", accessId: values.accessId?.trim() || "", accessKey: values.accessKey?.trim() || "" };
            const result = editing === "new" ? await createSMSChannel(input) : await updateSMSChannel(editing.id, input);
            if (!result.id || !result.hasCredentials || ["name", "provider", "enabled", "priority", "dailyLimit", "signName", "appId"].some((key) => result[key as keyof SMSChannel] !== input[key as keyof SMSChannelInput]) || JSON.stringify(result.templates) !== JSON.stringify(input.templates)) throw new Error("服务端返回的渠道与本次保存不一致，请刷新后核对");
            setChannels((current) => [...(current || []).filter((item) => item.id !== result.id), result].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)));
            setEditing(null);
            setDirty(false);
            form.resetFields();
            message.success("短信渠道已保存；如需开放登录或注册，请保存上方验证方式");
        } catch (err) {
            message.error(`${err instanceof Error ? err.message : "保存失败"}。请刷新渠道核对结果，未自动重试。`);
        } finally {
            mutation.current = false;
            setSaving(false);
        }
    };
    const remove = (channel: SMSChannel) =>
        modal.confirm({
            title: `删除短信渠道「${channel.name}」？`,
            content: "发送记录将保留。",
            okText: "删除渠道",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                if (mutation.current) return;
                mutation.current = true;
                setDeleting(true);
                try {
                    await deleteSMSChannel(channel.id);
                    setChannels((current) => current?.filter((item) => item.id !== channel.id) ?? null);
                    message.success("短信渠道已删除");
                } catch (err) {
                    message.error(err instanceof Error ? err.message : "删除失败");
                    throw err;
                } finally {
                    mutation.current = false;
                    setDeleting(false);
                }
            },
        });
    const sendTest = async () => {
        if (!testChannel || testInFlight.current || cooldown > 0) return;
        if (!/^(\+86)?1[3-9]\d{9}$/.test(testPhone.trim())) {
            message.warning("请输入中国大陆手机号（支持 +86）");
            return;
        }
        testInFlight.current = true;
        setTesting(true);
        setCooldown(60);
        try {
            const result = await testSMSChannel(testChannel.id, { phone: testPhone.trim(), purpose: testPurpose });
            message.info(`测试短信：${stateLabels[result.state] || result.state}${result.errorCode ? `（${result.errorCode}）` : ""}，请核对发送记录及手机收件`);
            setTestChannel(null);
            setTestPhone("");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "测试发送失败，请核对记录后再试");
        } finally {
            testInFlight.current = false;
            setTesting(false);
            setPage(1);
            setRecordsReload((n) => n + 1);
        }
    };

    return (
        <SettingsSectionCard className="admin-access-section" layout="stacked" icon={<MessageSquare className="size-4" />} title="短信渠道与发送记录" description="配置阿里云、腾讯云或互亿无线短信，按登录、注册、绑定场景使用已审核模板。优先级数值越小越优先。">
            <div className="space-y-4 p-4">
                <Callout title="配置顺序">
                    先在
                    <Link to="/admin/plugins" className="admin-table-primary-link mx-1">
                        插件管理
                    </Link>
                    启用对应短信插件，再新增渠道、配置签名与模板并启用，最后在上方选择手机号验证方式。短信目前支持中国大陆 +86 手机号。
                </Callout>
                <div className="flex flex-wrap justify-end gap-2">
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} disabled={saving || deleting} onClick={() => void load()}>
                        刷新渠道
                    </Button>
                    <Button icon={<Plus className="size-4" />} disabled={!channels || loading || saving || deleting} onClick={() => openEditor("new")}>
                        新增短信渠道
                    </Button>
                </div>
                {error && <Callout tone="error">{error}。请重新读取当前配置。</Callout>}
                <Table<SMSChannel>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    loading={loading}
                    dataSource={channels || []}
                    scroll={{ x: 700 }}
                    locale={{ emptyText: <AdminTableEmpty title="暂无短信渠道" description="新增渠道后可启用手机号验证码登录与注册。" /> }}
                    columns={[
                        {
                            title: "渠道",
                            dataIndex: "name",
                            render: (name, row) => (
                                <div>
                                    <strong>{name}</strong>
                                    <div className="text-xs text-foreground/50">
                                        {providers.find((p) => p.value === row.provider)?.label || row.provider} · 优先级 {row.priority} · 每日 {row.dailyLimit} 次
                                    </div>
                                </div>
                            ),
                        },
                        { title: "场景", render: (_, row) => row.templates.map((t) => purposeLabels[t.purpose]).join("、") },
                        { title: "状态", align: "center", render: (_, row) => <AdminStatusBadge label={!row.pluginEnabled ? "插件未启用" : row.enabled ? "已启用" : "已停用"} tone={!row.pluginEnabled ? "warning" : row.enabled ? "success" : "neutral"} /> },
                        {
                            title: "操作",
                            align: "center",
                            render: (_, row) => (
                                <div className="flex justify-center gap-1">
                                    <Button size="small" icon={<Pencil className="size-3.5" />} disabled={deleting} onClick={() => openEditor(row)}>
                                        编辑
                                    </Button>
                                    <Button
                                        size="small"
                                        disabled={!row.enabled || !row.pluginEnabled || deleting || cooldown > 0}
                                        onClick={() => {
                                            setTestChannel(row);
                                            setTestPurpose(row.templates[0].purpose);
                                            setTestPhone("");
                                        }}
                                    >
                                        测试
                                    </Button>
                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={row.enabled || deleting} title={row.enabled ? "请先编辑并停用渠道" : "删除渠道"} onClick={() => remove(row)}>
                                        删除
                                    </Button>
                                </div>
                            ),
                        },
                    ]}
                />
                <div className="flex items-center justify-between gap-3">
                    <strong>发送记录</strong>
                    <Button size="small" loading={recordsLoading} onClick={() => setRecordsReload((n) => n + 1)}>
                        刷新记录
                    </Button>
                </div>
                <p className="text-xs text-foreground/50">供应商受理不代表实际送达；状态未知时先核对供应商记录。发送记录仅显示脱敏号码，不显示验证码或密钥。</p>
                {recordsError && <Callout tone="error">{recordsError}</Callout>}
                <Table<SMSRecord>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    loading={recordsLoading}
                    dataSource={records}
                    scroll={{ x: 700 }}
                    locale={{ emptyText: <AdminTableEmpty title="暂无发送记录" /> }}
                    columns={[
                        { title: "时间", dataIndex: "createdAt", align: "center", render: (value) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
                        { title: "渠道", dataIndex: "channelName" },
                        { title: "场景", dataIndex: "purpose", align: "center", render: (value: VerificationPurpose) => purposeLabels[value] },
                        { title: "手机号", dataIndex: "maskedPhone" },
                        {
                            title: "结果",
                            align: "center",
                            render: (_, row) => (
                                <div>
                                    <AdminStatusBadge label={stateLabels[row.state] || row.state} tone={row.state === "accepted" ? "success" : row.state === "rejected" ? "error" : "warning"} />
                                    <div className="text-xs text-foreground/50">{row.errorCode}</div>
                                </div>
                            ),
                        },
                    ]}
                />
                <PaginationBar current={page} pageSize={10} pageSizeOptions={[10]} total={total} onChange={setPage} />
            </div>
            <AdminDrawer
                title={editing === "new" ? "新增短信渠道" : `编辑短信渠道 · ${editing?.name || ""}`}
                open={Boolean(editing)}
                size="min(680px, 100vw)"
                onClose={closeEditor}
                mask={{ closable: !saving }}
                extra={
                    <Button type="primary" loading={saving} onClick={() => void save()}>
                        保存渠道
                    </Button>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false} disabled={saving} onValuesChange={() => setDirty(true)}>
                    <Form.Item name="name" label="渠道名称" rules={[{ required: true, whitespace: true, message: "请填写渠道名称" }]}>
                        <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item name="provider" label="短信供应商" rules={[{ required: true }]}>
                        <Select
                            options={providers}
                            disabled={saving || editing !== "new"}
                            onChange={() => {
                                const nextProvider = form.getFieldValue("provider");
                                const templates = form.getFieldValue("templates") as SMSChannelInput["templates"];
                                form.setFieldValue(
                                    "templates",
                                    templates.map((t) => ({ ...t, parameters: t.parameters.map((p, i) => ({ ...p, name: nextProvider === "tencent" || nextProvider === "huyi" ? String(i) : p.value })) })),
                                );
                            }}
                        />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用渠道" valuePropName="checked" extra="启用前需先开启对应短信插件；仅保存渠道不会自动开放验证码登录或注册。">
                        <Switch aria-label="启用短信渠道" />
                    </Form.Item>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
                            <InputNumber min={0} max={1000} precision={0} className="w-full" />
                        </Form.Item>
                        <Form.Item name="dailyLimit" label="每日发送限额" rules={[{ required: true }]}>
                            <InputNumber min={1} max={100000} precision={0} className="w-full" />
                        </Form.Item>
                    </div>
                    {provider === "huyi" ? (
                        <Callout title="互亿无线模板变量模式">
                            在互亿无线控制台配置并审核签名与模板，这里填写 APIID、APIKEY 和模板 ID。变量按模板顺序传入；调试模板 ID 为 1，仅包含一个验证码变量。
                            <a href="https://www.ihuyi.com/doc/msg/sms/api/Submit.html" target="_blank" rel="noreferrer" className="admin-table-primary-link ml-1">
                                查看接口文档
                            </a>
                        </Callout>
                    ) : (
                        <Form.Item name="signName" label="短信签名" rules={[{ required: true, whitespace: true, message: "请填写已审核签名" }]}>
                            <Input maxLength={80} />
                        </Form.Item>
                    )}
                    {provider === "tencent" && (
                        <Form.Item name="appId" label="短信 SDK AppID" rules={[{ required: true, whitespace: true, message: "请填写腾讯云短信 SDK AppID" }]}>
                            <Input maxLength={80} />
                        </Form.Item>
                    )}
                    <Form.Item name="accessId" label={provider === "huyi" ? "APIID" : provider === "tencent" ? "SecretId" : "AccessKey ID"} rules={[{ required: editing === "new", whitespace: true, message: "请填写凭据 ID" }]}>
                        <Input autoComplete="off" placeholder={editing !== "new" ? configuredSecretText : ""} />
                    </Form.Item>
                    <Form.Item
                        name="accessKey"
                        label={provider === "huyi" ? "APIKEY" : provider === "tencent" ? "SecretKey" : "AccessKey Secret"}
                        rules={[{ required: editing === "new", whitespace: true, message: "请填写密钥" }]}
                        extra="凭据在服务端加密保存，不会回显。编辑时两项留空保留原凭据，更换时需同时填写。"
                    >
                        <Input.Password autoComplete="new-password" placeholder={editing !== "new" ? configuredSecretText : ""} />
                    </Form.Item>
                    <Form.List name="templates">
                        {(fields, { add, remove }) => (
                            <div className="space-y-4">
                                {fields.map((field) => (
                                    <div key={field.key} className="space-y-2 border-t border-foreground/10 pt-4">
                                        <div className="flex items-center justify-between">
                                            <strong>场景模板 {field.name + 1}</strong>
                                            <Button size="small" danger disabled={fields.length === 1 || saving} onClick={() => remove(field.name)}>
                                                移除模板
                                            </Button>
                                        </div>
                                        <Form.Item name={[field.name, "purpose"]} label="使用场景" rules={[{ required: true }]}>
                                            <Select options={purposes} />
                                        </Form.Item>
                                        <Form.Item name={[field.name, "templateId"]} label="已审核模板 ID" rules={[{ required: true, whitespace: true, message: "请填写模板 ID" }]}>
                                            <Input maxLength={100} />
                                        </Form.Item>
                                        <p className="text-xs text-foreground/50">{orderedParameters ? "参数按模板顺序填写，名称必须为 0、1…" : "参数名称须与阿里云模板中的变量名一致"}；code 为验证码，minutes 为有效分钟数。{provider === "huyi" && "变量将按顺序以 | 连接；模板只有验证码时仅保留一个参数。"}</p>
                                        <Form.List name={[field.name, "parameters"]}>
                                            {(parameters, actions) => (
                                                <>
                                                    {parameters.map((parameter, index) => (
                                                        <div key={parameter.key} className="flex items-start gap-2">
                                                            <Form.Item name={[parameter.name, "name"]} label="参数名称" rules={[{ required: true, pattern: /^[a-zA-Z0-9_]{1,40}$/, message: "使用字母、数字或下划线" }]} className="min-w-0 flex-1">
                                                                <Input readOnly={orderedParameters} />
                                                            </Form.Item>
                                                            <Form.Item name={[parameter.name, "value"]} label="参数值" rules={[{ required: true }]} className="min-w-0 flex-1">
                                                                <Select
                                                                    options={[
                                                                        { value: "code", label: "验证码" },
                                                                        { value: "minutes", label: "有效分钟数" },
                                                                    ]}
                                                                />
                                                            </Form.Item>
                                                            <Button
                                                                className="mt-7"
                                                                size="small"
                                                                danger
                                                                disabled={parameters.length === 1 || saving}
                                                                onClick={() => {
                                                                    actions.remove(parameter.name);
                                                                    if (orderedParameters) {
                                                                        const values = form.getFieldValue(["templates", field.name, "parameters"]) as SMSChannelInput["templates"][number]["parameters"];
                                                                        form.setFieldValue(["templates", field.name, "parameters"], values.map((p, i) => ({ ...p, name: String(i) })));
                                                                    }
                                                                    setDirty(true);
                                                                }}
                                                                aria-label={`移除参数 ${index + 1}`}
                                                            >
                                                                <Trash2 className="size-3.5" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                    <Button size="small" disabled={parameters.length >= 8 || saving} onClick={() => actions.add({ name: orderedParameters ? String(parameters.length) : "minutes", value: "minutes" })}>
                                                        添加参数
                                                    </Button>
                                                </>
                                            )}
                                        </Form.List>
                                    </div>
                                ))}
                                <Button
                                    disabled={fields.length >= 3 || saving}
                                    onClick={() =>
                                        add({
                                            purpose: purposes.find((p) => !(form.getFieldValue("templates") as SMSChannelInput["templates"]).some((t) => t.purpose === p.value))?.value,
                                            templateId: "",
                                            parameters: [{ name: orderedParameters ? "0" : "code", value: "code" }],
                                        })
                                    }
                                >
                                    添加场景模板
                                </Button>
                            </div>
                        )}
                    </Form.List>
                </Form>
            </AdminDrawer>
            <AdminModal
                title="发送测试短信"
                open={Boolean(testChannel)}
                onCancel={() => {
                    if (!testing) {
                        setTestChannel(null);
                        setTestPhone("");
                    }
                }}
                confirmLoading={testing}
                okText={cooldown > 0 ? `${cooldown} 秒后可重试` : "发送测试短信"}
                okButtonProps={{ disabled: cooldown > 0 || !testPhone.trim() }}
                cancelButtonProps={{ disabled: testing }}
                mask={{ closable: !testing }}
                onOk={() => void sendTest()}
            >
                <div className="space-y-4">
                    <Callout>向指定手机发送真实短信，可能产生供应商费用；测试码不能用于登录或注册。</Callout>
                    <label className="block space-y-2">
                        <span>使用场景</span>
                        <Select ariaLabel="测试短信场景" value={testPurpose} disabled={testing} options={testChannel?.templates.map((t) => ({ value: t.purpose, label: purposeLabels[t.purpose] }))} onChange={setTestPurpose} />
                    </label>
                    <label className="block space-y-2">
                        <span>测试手机号</span>
                        <Input value={testPhone} disabled={testing} onChange={(e) => setTestPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="中国大陆手机号，支持 +86" />
                    </label>
                </div>
            </AdminModal>
        </SettingsSectionCard>
    );
}
