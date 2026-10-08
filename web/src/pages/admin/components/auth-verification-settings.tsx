import { App, Button, Form, Skeleton } from "antd";
import { KeyRound, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { getVerificationPolicy, saveVerificationPolicy, type VerificationPolicy } from "@/services/api/verification";
import { Callout, Select, Switch } from "../ui/controls";
import { AdminStatusBadge, SettingsSectionCard } from "./admin-ui";
import SMSChannelsPanel from "./sms-channels-panel";

type RegistrationMode = "none" | "email" | "sms" | "either" | "both";
const registrationOptions: Array<{ value: RegistrationMode; label: string }> = [
    { value: "email", label: "邮箱验证码" },
    { value: "sms", label: "手机号验证码" },
    { value: "either", label: "邮箱或手机号，用户任选" },
    { value: "both", label: "邮箱和手机号，必须同时验证" },
    { value: "none", label: "关闭普通验证码注册" },
];

function registrationMode(policy: VerificationPolicy): RegistrationMode {
    if (policy.smsAndEmailRegistration) return "both";
    if (policy.smsRegistration && policy.emailRegistration) return "either";
    if (policy.smsRegistration) return "sms";
    if (policy.emailRegistration) return "email";
    return "none";
}

export default function AuthVerificationSettings({ onUnsavedChange }: { onUnsavedChange: (dirty: boolean) => void }) {
    const { message, modal } = App.useApp();
    const [policy, setPolicy] = useState<VerificationPolicy | null>(null);
    const [draft, setDraft] = useState<VerificationPolicy | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [channelUnsaved, setChannelUnsaved] = useState(false);
    const requestVersion = useRef(0);
    const inFlight = useRef(false);
    const dirty = Boolean(policy && draft && Object.keys(policy).some((key) => policy[key as keyof VerificationPolicy] !== draft[key as keyof VerificationPolicy]));

    useEffect(() => {
        onUnsavedChange(dirty || saving || channelUnsaved);
    }, [dirty, saving, channelUnsaved, onUnsavedChange]);
    useEffect(() => () => onUnsavedChange(false), [onUnsavedChange]);
    const load = useCallback(async () => {
        const version = ++requestVersion.current;
        setLoading(true);
        setError("");
        try {
            const result = await getVerificationPolicy();
            if (version !== requestVersion.current) return;
            setPolicy(result);
            setDraft(result);
        } catch (err) {
            if (version === requestVersion.current) setError(err instanceof Error ? err.message : "读取验证方式失败");
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load();
        return () => {
            requestVersion.current++;
        };
    }, [load]);
    const refresh = () => {
        if (!dirty) void load();
        else modal.confirm({ title: "放弃验证方式调整并刷新？", content: "将以服务端当前配置覆盖未保存的验证方式。", okText: "放弃并刷新", cancelText: "继续编辑", onOk: load });
    };
    const save = async () => {
        if (!draft || inFlight.current) return;
        inFlight.current = true;
        setSaving(true);
        setError("");
        try {
            const result = await saveVerificationPolicy(draft);
            if (Object.keys(draft).some((key) => result[key as keyof VerificationPolicy] !== draft[key as keyof VerificationPolicy])) throw new Error("服务端返回的验证方式与本次保存不一致，请刷新后核对");
            setPolicy(result);
            setDraft(result);
            message.success("验证码登录与注册方式已保存，登录和注册页刷新后生效");
        } catch (err) {
            const detail = err instanceof Error ? err.message : "保存验证方式失败";
            setError(`${detail}。请核对邮件及短信渠道配置；结果不确定时刷新确认，未自动重试。`);
            message.error(detail);
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    };
    return (
        <>
            <SettingsSectionCard
                className="admin-access-section"
                icon={<KeyRound className="size-4" />}
                title="验证码登录与注册方式"
                description="邮箱和手机号可分别使用，也可同时开放给用户选择。修改后点击保存生效。"
                status={<AdminStatusBadge label={dirty ? "待保存" : "按已保存策略运行"} tone={dirty ? "warning" : "neutral"} />}
                footer={
                    <>
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} disabled={saving} onClick={refresh}>
                            刷新验证方式
                        </Button>
                        <div className="flex gap-2">
                            {dirty && (
                                <Button
                                    icon={<RotateCcw className="size-4" />}
                                    disabled={saving || loading}
                                    onClick={() => {
                                        setDraft(policy);
                                        setError("");
                                    }}
                                >
                                    撤销
                                </Button>
                            )}
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
                                保存验证方式
                            </Button>
                        </div>
                    </>
                }
            >
                <div className="space-y-4 p-4">
                    {error && <Callout tone="error">{error}</Callout>}
                    {!draft ? (
                        loading ? (
                            <Skeleton active paragraph={{ rows: 3 }} />
                        ) : (
                            <Callout tone="error">验证方式未读取，暂时不能修改。请点击刷新重试。</Callout>
                        )
                    ) : (
                        <Form layout="vertical" requiredMark={false}>
                            <div className="mb-4 flex items-center justify-between gap-4">
                                <div>
                                    <strong>邮箱验证码登录</strong>
                                    <p className="m-0 text-xs text-foreground/50">已验证邮箱的账号可以使用邮件验证码登录。</p>
                                </div>
                                <Switch checked={draft.emailLogin} disabled={loading || saving} aria-label="邮箱验证码登录" onChange={(enabled) => setDraft({ ...draft, emailLogin: enabled })} />
                            </div>
                            <div className="mb-4 flex items-center justify-between gap-4">
                                <div>
                                    <strong>手机号验证码登录</strong>
                                    <p className="m-0 text-xs text-foreground/50">已验证手机号的账号可以使用短信验证码登录。</p>
                                </div>
                                <Switch checked={draft.smsLogin} disabled={loading || saving} aria-label="手机号验证码登录" onChange={(enabled) => setDraft({ ...draft, smsLogin: enabled })} />
                            </div>
                            <Form.Item label="注册验证方式" extra="手机号注册不要求邮箱；双重验证需要分别填写两条验证码。注册开放仍由上方「允许创建新账号」控制。">
                                <Select
                                    ariaLabel="注册验证方式"
                                    value={registrationMode(draft)}
                                    disabled={loading || saving}
                                    options={registrationOptions}
                                    onChange={(mode) => setDraft({ ...draft, emailRegistration: mode === "email" || mode === "either", smsRegistration: mode === "sms" || mode === "either", smsAndEmailRegistration: mode === "both" })}
                                />
                            </Form.Item>
                            <Callout>
                                邮箱方式需先配置
                                <Link to="/admin/settings/email" className="admin-table-primary-link mx-1">
                                    邮件服务
                                </Link>
                                ；手机号方式需配置下方短信渠道的对应场景模板。已有账号密码登录继续可用；联系方式必须经过验证才能用于验证码登录。双重验证注册会阻止未同时验证的新 Linux.do 账号创建。
                            </Callout>
                        </Form>
                    )}
                </div>
            </SettingsSectionCard>
            <SMSChannelsPanel onUnsavedChange={setChannelUnsaved} />
        </>
    );
}
