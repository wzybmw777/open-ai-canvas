import { compactApiParams, http } from "./request";
import type { VerificationPurpose } from "./verification";

export type SMSProvider = "aliyun" | "tencent" | "huyi";
export type SMSTemplate = {
    purpose: VerificationPurpose;
    templateId: string;
    parameters: Array<{ name: string; value: "code" | "minutes" }>;
};
export type SMSChannelInput = {
    name: string;
    provider: SMSProvider;
    enabled: boolean;
    priority: number;
    dailyLimit: number;
    signName: string;
    appId: string;
    accessId: string;
    accessKey: string;
    templates: SMSTemplate[];
    version: number;
};
export type SMSChannel = Omit<SMSChannelInput, "accessId" | "accessKey"> & {
    id: string;
    hasCredentials: boolean;
    pluginEnabled: boolean;
    createdAt: string;
    updatedAt: string;
};
export type SMSRecord = {
    id: string;
    channelId: string;
    channelName: string;
    provider: SMSProvider;
    purpose: VerificationPurpose;
    maskedPhone: string;
    state: string;
    requestId: string;
    messageId: string;
    errorCode: string;
    durationMs: number;
    createdAt: string;
};

export const listSMSChannels = () => http.get<SMSChannel[]>("/admin/sms/channels");
export const createSMSChannel = (input: SMSChannelInput) => http.post<SMSChannel>("/admin/sms/channels", input);
export const updateSMSChannel = (id: string, input: SMSChannelInput) => http.put<SMSChannel>(`/admin/sms/channels/${encodeURIComponent(id)}`, input);
export const deleteSMSChannel = (id: string) => http.delete<{ deleted: boolean }>(`/admin/sms/channels/${encodeURIComponent(id)}`);
export const testSMSChannel = (id: string, input: { phone: string; purpose: VerificationPurpose }) => http.post<SMSRecord>(`/admin/sms/channels/${encodeURIComponent(id)}/test`, input);
export const listSMSRecords = (params: { channelId?: string; state?: string; page: number; pageSize: number }, signal?: AbortSignal) => http.get<{ items: SMSRecord[]; total: number }>("/admin/sms/records", { params: compactApiParams(params), signal });
