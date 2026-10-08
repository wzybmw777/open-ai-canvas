import { expect, test } from "bun:test";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";

import { VerificationFields } from "../src/components/auth/verification-fields";
import { apiClient, ApiError } from "../src/services/api/request";
import { createSMSChannel, deleteSMSChannel, listSMSRecords, testSMSChannel, updateSMSChannel, type SMSChannelInput } from "../src/services/api/sms";
import { emptyVerification, loginVerification, saveVerificationPolicy, startVerification, verificationMethods, type VerificationPolicy } from "../src/services/api/verification";

const policy: VerificationPolicy = { smsLogin: true, emailLogin: true, smsRegistration: true, emailRegistration: true, smsAndEmailRegistration: false };

test("邮箱和手机号可单独启用、共同选择或要求双重注册验证", () => {
    expect(verificationMethods(policy, "login")).toEqual(["sms", "email"]);
    expect(verificationMethods(policy, "register")).toEqual(["sms", "email"]);
    expect(verificationMethods({ ...policy, emailRegistration: false }, "register")).toEqual(["sms"]);
    expect(verificationMethods({ ...policy, smsRegistration: false }, "register")).toEqual(["email"]);
    expect(verificationMethods({ ...policy, smsAndEmailRegistration: true, smsRegistration: false, emailRegistration: false }, "register")).toEqual(["sms_email"]);
    expect(verificationMethods({ ...policy, smsLogin: false, emailLogin: false }, "login")).toEqual([]);
});

test("双重验证渲染独立短信和邮件验证码，只使用一个发送操作", () => {
    const html = renderToStaticMarkup(
        <App>
            <VerificationFields purpose="register" method="sms_email" value={{ ...emptyVerification, email: "member@example.com", phone: "13800138000", smsCode: "123456", emailCode: "654321" }} onChange={() => {}} />
        </App>,
    );
    expect(html).toContain('value="123456"');
    expect(html).toContain('value="654321"');
    expect((html.match(/autoComplete="one-time-code"/g) || []).length).toBe(2);
    expect((html.match(/class="[^"]*auth-code-send/g) || []).length).toBe(1);
    expect(html).toMatch(/短信验证码|SMS code/);
    expect(html).toMatch(/邮件验证码|Email code/);
});

test("手机号注册表单不需要邮箱，保留短信验证码输入", () => {
    const html = renderToStaticMarkup(
        <App>
            <VerificationFields purpose="register" method="sms" value={emptyVerification} onChange={() => {}} />
        </App>,
    );
    expect(html).toContain('autoComplete="tel"');
    expect(html).not.toContain('type="email"');
    expect((html.match(/autoComplete="one-time-code"/g) || []).length).toBe(1);
});

test("验证请求和登录保留票据与两个验证码，不向 URL 放手机号或凭据", async () => {
    const original = apiClient.defaults.adapter;
    const calls: Array<{ url: string | undefined; body: unknown }> = [];
    try {
        apiClient.defaults.adapter = async (config) => {
            calls.push({ url: config.url, body: JSON.parse(config.data) });
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: config.url === "/auth/verification" ? { ticket: "id.secret", retryAfter: 60, expiresIn: 600 } : { user: { id: "member" } } } };
        };
        expect((await startVerification({ purpose: "register", method: "sms", phone: "13800138000" })).ticket).toBe("id.secret");
        await loginVerification({ ...emptyVerification, ticket: "id.secret", smsCode: "123456", emailCode: "654321" });
        expect(calls[0]).toEqual({ url: "/auth/verification", body: { purpose: "register", method: "sms", phone: "13800138000" } });
        expect(calls[1]?.url).toBe("/auth/verification/login");
        expect(calls[1]?.body).toMatchObject({ ticket: "id.secret", smsCode: "123456", emailCode: "654321" });
    } finally {
        apiClient.defaults.adapter = original;
    }
});

const channel: SMSChannelInput = {
    name: "短信渠道",
    provider: "aliyun",
    enabled: false,
    priority: 1,
    dailyLimit: 100,
    signName: "签名",
    appId: "",
    accessId: "",
    accessKey: "",
    version: 3,
    templates: [{ purpose: "register", templateId: "template", parameters: [{ name: "code", value: "code" }] }],
};

test("互亿无线渠道提交 API 凭据及有序模板变量，无需签名和 AppID", async () => {
    const original = apiClient.defaults.adapter;
    try {
        apiClient.defaults.adapter = async (config) => {
            expect(config.url).toBe("/admin/sms/channels");
            const body = JSON.parse(config.data);
            expect(body).toMatchObject({ provider: "huyi", signName: "", appId: "", accessId: "test-api-id", accessKey: "test-api-key" });
            expect(body.templates[0].parameters).toEqual([{ name: "0", value: "code" }, { name: "1", value: "minutes" }]);
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { id: "huyi-channel", hasCredentials: true } } };
        };
        const result = await createSMSChannel({ ...channel, provider: "huyi", signName: "", appId: "", accessId: "test-api-id", accessKey: "test-api-key", templates: [{ purpose: "register", templateId: "123", parameters: [{ name: "0", value: "code" }, { name: "1", value: "minutes" }] }] });
        expect(result.id).toBe("huyi-channel");
    } finally {
        apiClient.defaults.adapter = original;
    }
});

test("短信渠道修改携带版本，测试发送走 JSON，记录查询保留分页和取消", async () => {
    const original = apiClient.defaults.adapter;
    const calls: Array<{ url: string | undefined; body: unknown; params: unknown; signal: unknown }> = [];
    const controller = new AbortController();
    try {
        apiClient.defaults.adapter = async (config) => {
            calls.push({ url: config.url, body: config.data ? JSON.parse(config.data) : undefined, params: config.params, signal: config.signal });
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items: [], total: 0 } } };
        };
        await updateSMSChannel("channel/1", channel);
        await testSMSChannel("channel/1", { phone: "13800138000", purpose: "register" });
        await listSMSRecords({ channelId: "", state: "", page: 2, pageSize: 10 }, controller.signal);
        expect(calls[0]?.url).toBe("/admin/sms/channels/channel%2F1");
        expect(calls[0]?.body).toEqual(channel);
        expect(calls[1]?.url).toBe("/admin/sms/channels/channel%2F1/test");
        expect(calls[1]?.body).toEqual({ phone: "13800138000", purpose: "register" });
        expect(calls[2]?.params).toEqual({ page: 2, pageSize: 10 });
        expect(calls[2]?.signal).toBe(controller.signal);
    } finally {
        apiClient.defaults.adapter = original;
    }
});

test("启用策略、渠道保存、删除与测试失败继续抛出业务错误", async () => {
    const original = apiClient.defaults.adapter;
    try {
        apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 403, msg: "操作被拒绝", reason: "forbidden" } });
        for (const operation of [
            () => saveVerificationPolicy(policy),
            () => createSMSChannel(channel),
            () => updateSMSChannel("channel", channel),
            () => deleteSMSChannel("channel"),
            () => testSMSChannel("channel", { phone: "13800138000", purpose: "register" }),
        ]) {
            try {
                await operation();
                throw new Error("write unexpectedly succeeded");
            } catch (err) {
                expect(err).toBeInstanceOf(ApiError);
                expect((err as ApiError).reason).toBe("forbidden");
            }
        }
    } finally {
        apiClient.defaults.adapter = original;
    }
});
