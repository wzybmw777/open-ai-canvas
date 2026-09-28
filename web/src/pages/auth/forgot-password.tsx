import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { getAuthSettings, resetPassword, sendPasswordResetEmailCode } from "@/services/api/auth";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";

type RecoveryStage = "request" | "reset";

export default function ForgotPasswordPage() {
    const { text } = useLocaleText();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [stage, setStage] = useState<RecoveryStage>("request");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const next = safeNext(params.get("next"));
    const loginURL = `/login?next=${encodeURIComponent(next)}`;

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((settings) => !cancelled && setEmailEnabled(settings.emailEnabled))
            .catch(() => !cancelled && setEmailEnabled(null));
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [countdown]);

    const sendCode = async (advance: boolean) => {
        const normalizedEmail = email.trim();
        if (!normalizedEmail) {
            message.warning(text("请先输入邮箱", "Enter your email address"));
            return;
        }
        setSendingCode(true);
        try {
            await sendPasswordResetEmailCode(normalizedEmail);
            setEmail(normalizedEmail);
            setCountdown(60);
            if (advance) setStage("reset");
            message.success(text("如果该邮箱已绑定可找回的账号，验证码将发送到邮箱", "If this address belongs to an eligible account, a code will be sent."));
        } catch (error) {
            message.error(localizedErrorMessage(error, "发送验证码失败", "Could not send code"));
        } finally {
            setSendingCode(false);
        }
    };

    const requestCode = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void sendCode(true);
    };

    const submitReset = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (password !== confirmPassword) {
            message.error(text("两次输入的密码不一致", "Passwords do not match"));
            return;
        }
        setSubmitting(true);
        try {
            await resetPassword({ email: email.trim(), emailCode, password });
            message.success(text("密码已重置，请使用新密码登录", "Password reset. Sign in with your new password."));
            navigate(loginURL, { replace: true });
        } catch (error) {
            message.error(localizedErrorMessage(error, "密码重置失败", "Could not reset password"));
        } finally {
            setSubmitting(false);
        }
    };

    const editEmail = () => {
        setStage("request");
        setEmailCode("");
        setPassword("");
        setConfirmPassword("");
        setCountdown(0);
    };

    if (stage === "request") {
        return (
            <form onSubmit={requestCode} className="space-y-5">
                {emailEnabled === false ? <Notice icon={<TriangleAlert className="size-3.5" />}>{text("管理员尚未启用密码找回，请联系管理员处理。", "Password recovery is disabled. Contact an administrator.")}</Notice> : null}
                <AuthField label={text("账号邮箱", "Account email")} htmlFor="recovery-email">
                    <Input
                        id="recovery-email"
                        size="large"
                        prefix={<Mail className="auth-scene-icon size-4" />}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder={text("请输入绑定邮箱", "Enter your account email")}
                        autoComplete="email"
                        inputMode="email"
                        required
                        disabled={emailEnabled === false}
                    />
                </AuthField>
                <Button type="primary" htmlType="submit" size="large" block loading={sendingCode} disabled={emailEnabled === false} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                    {text("发送验证码", "Send code")}
                </Button>
                <BackToLogin to={loginURL} />
            </form>
        );
    }

    return (
        <form onSubmit={submitReset} className="space-y-4">
            <AuthField label={text("账号邮箱", "Account email")} htmlFor="recovery-email-confirm">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input id="recovery-email-confirm" size="large" prefix={<Mail className="auth-scene-icon size-4" />} value={email} readOnly autoComplete="email" />
                    <Button htmlType="button" size="large" onClick={editEmail}>
                        {text("修改邮箱", "Edit email")}
                    </Button>
                </div>
            </AuthField>
            <AuthField label={text("邮箱验证码", "Email code")} htmlFor="recovery-code">
                <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                    <Input
                        id="recovery-code"
                        size="large"
                        prefix={<ShieldCheck className="auth-scene-icon size-4" />}
                        value={emailCode}
                        onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder={text("6 位验证码", "6-digit code")}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                    />
                    <Button htmlType="button" size="large" loading={sendingCode} disabled={countdown > 0} onClick={() => void sendCode(false)}>
                        {countdown > 0 ? `${countdown}s` : text("重新发送", "Resend")}
                    </Button>
                </div>
            </AuthField>
            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label={text("新密码", "New password")} htmlFor="recovery-password">
                    <Input.Password
                        id="recovery-password"
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={text("至少 8 位", "At least 8 characters")}
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                </AuthField>
                <AuthField label={text("确认密码", "Confirm password")} htmlFor="recovery-confirm-password">
                    <Input.Password
                        id="recovery-confirm-password"
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder={text("再次输入密码", "Enter password again")}
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                </AuthField>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {text("重置密码", "Reset password")}
            </Button>
            <BackToLogin to={loginURL} />
        </form>
    );
}

function AuthField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <label htmlFor={htmlFor} className="auth-scene-label block text-xs font-medium">
                {label}
            </label>
            {children}
        </div>
    );
}

function BackToLogin({ to }: { to: string }) {
    const { text } = useLocaleText();
    return (
        <div className="text-center">
            <Link to={to} className="auth-scene-link inline-flex min-h-8 items-center gap-1.5 rounded-sm text-xs transition-colors">
                <ArrowLeft className="size-3.5" />
                {text("返回登录", "Back to sign in")}
            </Link>
        </div>
    );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
    return (
        <div className="auth-scene-notice flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {children}
        </div>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
