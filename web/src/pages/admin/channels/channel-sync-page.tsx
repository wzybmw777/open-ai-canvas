import { App, Button, Form, Input, InputNumber, Spin } from "antd";
import { History, Pencil, Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AdminModal } from "../ui/overlays";
import { Checkbox, Select, Switch } from "../ui/controls";
import { listChannelSyncJobs, listChannelSyncRuns, runChannelSyncJob, saveChannelSyncJob, type ChannelSyncConfig, type ChannelSyncRun, type ChannelSyncView } from "@/services/api/channel-sync";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge } from "../components/admin-ui";
import "./channel-sync-page.css";

const scriptLabels = { "authorized-models": "授权目录监控", "model-plaza": "模型广场价格同步" };
const date = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";

export function describeChannelSyncRun(run: ChannelSyncRun) {
    if (run.status === "running") return "正在读取上游并核对本地配置…";
    if (run.status === "failed") return run.summary;
    try {
        const result = JSON.parse(run.summary) as { authorized: number; added: number; disabled: number; prices: number; descriptions: number; warnings: string[] };
        return `授权 ${result.authorized} 个 · 新增 ${result.added} 个 · 停用 ${result.disabled} 个 · 更新 ${result.prices} 个价格档、${result.descriptions} 个简介${result.warnings?.length ? `；${result.warnings.join("；")}` : ""}`;
    } catch { return run.summary; }
}

export default function ChannelSyncPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const jobs = useQuery({ queryKey: ["admin", "channel-sync"], queryFn: ({ signal }) => listChannelSyncJobs(signal), refetchInterval: 5000 });
    const [editing, setEditing] = useState<ChannelSyncView | null>(null);
    const [history, setHistory] = useState<ChannelSyncView | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<ChannelSyncConfig>();
    const script = Form.useWatch("script", form);
    const runs = useQuery({ queryKey: ["admin", "channel-sync-runs", history?.channelId], queryFn: ({ signal }) => listChannelSyncRuns(history!.channelId, signal), enabled: Boolean(history), refetchInterval: history ? 5000 : false });
    useEffect(() => { if (editing) form.setFieldsValue(editing.job); }, [editing, form]);
    const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["admin", "channel-sync"] }); };
    const handleRun = async (row: ChannelSyncView) => {
        setBusy(row.channelId);
        try { await runChannelSyncJob(row.channelId); message.success("同步任务已开始，可在执行记录中查看结果"); await refresh(); }
        catch (error) { message.error(error instanceof Error ? error.message : "启动同步失败"); }
        finally { setBusy(null); }
    };
    const toggle = async (row: ChannelSyncView, enabled: boolean) => {
        setBusy(row.channelId);
        try { await saveChannelSyncJob(row.channelId, { ...row.job, enabled }); await refresh(); }
        catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
        finally { setBusy(null); }
    };
    const save = async () => {
        const values = await form.validateFields().catch(() => null);
        if (!editing || !values) return;
        setSaving(true);
        try {
            await saveChannelSyncJob(editing.channelId, { ...values, groupId: values.groupId || 0, sourceUrl: values.sourceUrl || "", syncPrices: values.script === "model-plaza" && Boolean(values.syncPrices), importNew: Boolean(values.importNew) });
            message.success("同步配置已保存"); setEditing(null); await refresh();
        } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
        finally { setSaving(false); }
    };
    return <AdminPageFrame title="渠道同步" description="每天北京时间 00:00 同步上游 · 执行记录保存在服务端" actions={<Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()}>刷新</Button>} scroll>
        <div className="channel-sync-page">
            <div className="channel-sync-notice">同步已有模型的授权与简介，按原成本／售价比例更新价格。新发现的模型先保持停用；手动停用的模型不会自动启用。网络异常、空目录和报价歧义均保留原配置。</div>
            {jobs.isPending ? <Spin /> : jobs.isError ? <div role="alert">{jobs.error.message}<Button onClick={() => void refresh()}>重试</Button></div> : null}
            <div className="channel-sync-grid">
                {jobs.data?.jobs.map(row => {
                    const running = row.lastRun?.status === "running";
                    return <section className="channel-sync-card" key={row.channelId}>
                        <div className="channel-sync-card-heading"><Link to={`/admin/channels?channel=${encodeURIComponent(row.channelId)}`}>{row.channelName}</Link><Switch checked={row.job.enabled} disabled={!row.configured || running} loading={busy === row.channelId} aria-label={`${row.channelName}每日同步`} onChange={enabled => void toggle(row, enabled)} /></div>
                        <div className="channel-sync-card-meta"><AdminStatusBadge label={!row.configured ? "待配置" : row.job.enabled ? "每日同步" : "已暂停"} tone={row.job.enabled ? "success" : "neutral"} /><span>{scriptLabels[row.job.script]}</span></div>
                        <dl><dt>下次执行</dt><dd>{date(row.job.nextRunAt)}</dd><dt>最近执行</dt><dd>{date(row.lastRun?.startedAt)}</dd></dl>
                        <div className="channel-sync-result">{row.lastRun ? <><AdminStatusBadge label={running ? "执行中" : row.lastRun.status === "success" ? "成功" : "失败"} tone={running ? "info" : row.lastRun.status === "success" ? "success" : "error"} /><p>{describeChannelSyncRun(row.lastRun)}</p></> : <p>尚无执行记录</p>}</div>
                        <div className="channel-sync-card-actions"><Button icon={<Pencil className="size-3.5" />} disabled={running} onClick={() => setEditing(row)}>配置脚本</Button><Button icon={<Play className="size-3.5" />} disabled={!row.configured || running} loading={busy === row.channelId} onClick={() => void handleRun(row)}>立即同步</Button><Button icon={<History className="size-3.5" />} onClick={() => setHistory(row)}>记录</Button></div>
                    </section>;
                })}
            </div>
        </div>
        <AdminModal title={`${editing?.channelName || "渠道"} · 同步脚本`} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={saving} okText="保存配置">
            <Form form={form} layout="vertical">
                <Form.Item name="script" label="同步脚本" rules={[{ required: true }]}><Select options={Object.entries(scriptLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
                {script === "model-plaza" ? <><Form.Item name="sourceUrl" label="公开价格目录地址" rules={[{ required: true, message: "请填写公开价格目录的 HTTPS 地址" }]}><Input placeholder="https://供应商域名/api/v1/model-plaza" /></Form.Item><Form.Item name="groupId" label="上游价格分组 ID" rules={[{ required: true }]}><InputNumber min={1} precision={0} /></Form.Item><Form.Item name="syncPrices" valuePropName="checked"><Checkbox>同步成本与售价，保留各价格档现有利润比例</Checkbox></Form.Item></> : null}
                <Form.Item name="importNew" valuePropName="checked"><Checkbox>导入新发现的型号（保持停用，待人工配置）</Checkbox></Form.Item>
                <Form.Item name="enabled" label="每日北京时间 00:00 自动执行" valuePropName="checked"><Switch /></Form.Item>
                <p className="channel-sync-form-note">授权目录使用渠道已保存的凭证。脚本无需填写密钥；暂停自动执行后仍可立即同步。</p>
            </Form>
        </AdminModal>
        <AdminModal title={`${history?.channelName || "渠道"} · 执行记录`} open={Boolean(history)} onCancel={() => setHistory(null)} footer={null} width={760}>
            <div className="channel-sync-history">{runs.isPending ? <Spin /> : runs.isError ? <p role="alert">{runs.error.message}</p> : runs.data?.runs.length ? runs.data.runs.map(run => <article key={run.id}><div><strong>{date(run.startedAt)}</strong><span>{run.trigger === "manual" ? "手动同步" : "每日同步"}</span><AdminStatusBadge label={run.status === "success" ? "成功" : run.status === "failed" ? "失败" : "执行中"} tone={run.status === "failed" ? "error" : run.status === "success" ? "success" : "info"} /></div><p>{describeChannelSyncRun(run)}</p></article>) : <p>尚无执行记录</p>}</div>
        </AdminModal>
    </AdminPageFrame>;
}
