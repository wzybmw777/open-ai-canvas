import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMicrocredits } from './sync-qt-channel.mjs';

export const SOURCE_URL = 'https://api.qtrader.cc/api/v1/model-plaza';
export const CHANNEL_NAME = 'QT H3渠道';
export const UPSTREAM_URL = 'https://api.qtrader.cc';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function buildSetup(catalog) {
  const groups = catalog?.data?.groups?.filter(group => group.id === 100);
  if (catalog?.code !== 0 || groups?.length !== 1) throw new Error('H3 price group missing or ambiguous');
  const group = groups[0];
  if (group.name !== 'sparkcine-h3组' || group.rate_multiplier !== 1 || group.peak_rate_enabled !== false ||
      (group.image_rate_independent && group.image_rate_multiplier !== 1) ||
      (group.video_rate_independent && group.video_rate_multiplier !== 1)) {
    throw new Error('H3 group pricing changed; review required');
  }
  const entries = group.models.filter(item => item.name === 'h3-video');
  if (entries.length !== 1 || entries[0].pricing?.billing_mode !== 'video' || entries[0].time_pricing) {
    throw new Error('H3 price or billing mode missing or ambiguous');
  }
  const upstream = entries[0];
  if (typeof upstream.description !== 'string' || !upstream.description.trim() || [...upstream.description].length > 500) {
    throw new Error('H3 description missing or too long');
  }
  const resolutions = ['480p', '720p', '768p', '960p', '1080p'];
  const intervals = upstream.pricing.intervals;
  if (!Array.isArray(intervals) || intervals.length !== resolutions.length) throw new Error('Review H3 resolution prices');
  const costs = new Map(resolutions.map(resolution => {
    const matches = intervals.filter(tier => tier.tier_label === resolution);
    if (matches.length !== 1 || matches[0].min_tokens !== 0 || matches[0].max_tokens !== null) {
      throw new Error('Missing or ambiguous H3 price tier');
    }
    const cost = toMicrocredits(matches[0].per_request_price);
    if (cost <= 0 || !Number.isSafeInteger(cost * 5)) throw new Error('Review H3 zero or excessive cost');
    return [resolution, cost];
  }));
  const models = [
    { key: 'h3-video', label: 'QT H3渠道 · 长视频', resolutions: resolutions.slice(0, 3), max: 30, ratios: ['16:9', '9:16'], default: '768p' },
    { key: 'h3-video-hd', label: 'QT H3渠道 · 高清', resolutions: resolutions.slice(3), max: 15, ratios: ['16:9', '9:16', '21:9', '4:3', '1:1', '3:4'], default: '1080p' },
  ].map(variant => ({
    modelKey: variant.key, providerModelKey: 'h3-video', displayName: 'MiniMax H3', channelLabel: variant.label,
    icon: 'Minimax', capability: 'video', protocol: 'qtrader-h3', enabled: true,
    description: `支持 4–${variant.max} 秒${variant.max === 30 ? '' : '高清'}视频生成，提供 ${variant.resolutions.join('、')} 分辨率及${variant.max === 30 ? '横屏/竖屏' : '多种'}画幅，最多 9 张参考图，按秒计费。`,
    tags: [
      { text: '文生视频', color: 'blue' }, { text: '9图参考', color: 'purple' },
      { text: variant.max === 30 ? '480–768p' : '960p/1080p', color: 'blue' },
      { text: `4–${variant.max}秒`, color: 'green' }, { text: '按秒计费', color: 'gold' },
    ],
    capabilityConfig: { version: 1, video: {
      operations: ['text_to_video', 'image_to_video', 'reference_to_video'], defaultOperation: 'text_to_video',
      references: { promptMaxChars: 12000, minImages: 0, maxImages: 9, maxImageBytes: 24 * 1024 * 1024,
        maxVideos: 0, maxVideoBytes: 0, maxVideoDurationSeconds: 0, maxAudios: 0, maxAudioBytes: 0, maxAudioDurationSeconds: 0 },
      duration: { selection: 'range', min: 4, max: variant.max, step: 1, default: 6 },
      ratios: variant.ratios, defaultRatio: '16:9', resolutions: variant.resolutions, defaultResolution: variant.default,
      generateAudio: { supported: false, default: false }, watermark: { supported: false, default: false },
    } },
    priceTiers: variant.resolutions.map(resolution => ({
      selector: { vquality: resolution }, providerModelKey: 'h3-video', billingMode: 'per_second',
      costPricing: { configured: true, unitPriceMicrocredits: costs.get(resolution) },
      unitPriceMicrocredits: Math.ceil(costs.get(resolution) * 5 / 4), priceConfigured: true, enabled: true,
    })),
  }));
  return { channel: { name: CHANNEL_NAME, baseUrl: UPSTREAM_URL, models: [], enabled: true }, models,
    sync: { enabled: true, script: 'model-plaza', sourceUrl: SOURCE_URL, groupId: 100, syncPrices: true, importNew: false } };
}

async function jsonRequest(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45_000) }); }
  catch { throw new Error('Connection failed; credentials and response bodies are omitted'); }
  if (!response.ok) throw new Error(`Request failed (HTTP ${response.status})`);
  try { return await response.json(); }
  catch { throw new Error('Invalid JSON response'); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && !['--dry-run', '--apply', '--sync'].includes(args[0])) {
    throw new Error('Usage: node scripts/sync-qtrader-h3.mjs [--dry-run|--apply|--sync]');
  }
  const mode = args[0] || '--dry-run';
  const setup = buildSetup(await jsonRequest(SOURCE_URL, { headers: { 'User-Agent': 'Mozilla/5.0 Yingce-Channel-Sync' } }));
  if (mode === '--dry-run') { console.log(JSON.stringify(setup, null, 2)); return; }
  const base = new URL(process.env.CANVAS_ADMIN_BASE_URL || '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('CANVAS_ADMIN_BASE_URL must be a credential-free HTTPS origin');
  }
  const cookie = process.env.CANVAS_ADMIN_COOKIE;
  if (!cookie || /[\r\n;]/.test(cookie)) throw new Error('CANVAS_ADMIN_COOKIE must contain the administrator session value');
  const api = async (path, method = 'GET', body, contentType = 'application/json') => {
    let envelope;
    try {
      envelope = await jsonRequest(new URL(`/api${path}`, base), { method,
        headers: { Cookie: `open_ai_canvas_session=${cookie}`, Origin: base.origin, 'Content-Type': contentType },
        body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body });
    } catch (error) { throw new Error(`${method} ${path}: ${error.message}`); }
    if (envelope.code !== 0) throw new Error(`Business API failed (code ${envelope.code})`);
    return envelope.data;
  };
  const channels = (await api('/admin/channels?limit=100')).channels;
  const matches = channels.filter(channel => channel.name === CHANNEL_NAME);
  if (matches.length > 1 || matches.some(channel => channel.baseUrl !== UPSTREAM_URL)) throw new Error('Ambiguous H3 channel identity');
  let channel = matches[0];
  if (mode === '--apply') {
    if (channel) throw new Error('H3 channel already exists; use --sync to preserve reviewed settings');
    const key = process.env.QTRADER_H3_API_KEY;
    if (!key || /[\r\n]/.test(key)) throw new Error('QTRADER_H3_API_KEY is required for initial setup');
    const catalog = await jsonRequest(`${UPSTREAM_URL}/v1/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!Array.isArray(catalog.data) || catalog.data.filter(model => model.id === 'h3-video').length !== 1) {
      throw new Error('h3-video is not uniquely authorized by this credential');
    }
    const directory = resolve(ROOT, 'plugin-packages/qtrader-h3');
    const packed = spawnSync('zip', ['-X', '-q', '-', 'manifest.json', 'README.md', 'docs/interface.md'], { cwd: directory });
    if (packed.status !== 0) throw new Error('Could not package H3 protocol');
    await api('/plugins', 'POST', packed.stdout, 'application/octet-stream');
    channel = (await api('/admin/channels', 'POST', { ...setup.channel, apiKey: key })).channel;
    // Keep a partially configured channel paused if any subsequent write fails.
    // The API remains the authority for credentials, IDs, capabilities and prices.
    try {
      for (const input of setup.models) await api(`/admin/channels/${channel.id}/models`, 'POST', input);
      await api(`/admin/channel-sync/${channel.id}`, 'PUT', setup.sync);
    } catch (error) {
      await api(`/admin/channels/${channel.id}`, 'PATCH', { ...setup.channel, enabled: false });
      throw error;
    }
  }
  if (!channel || !channel.enabled) throw new Error('An enabled, reviewed H3 channel is required');
  const models = (await api(`/admin/channels/${channel.id}/models`)).models;
  if (models.length !== 2 || models.some(model => !['h3-video', 'h3-video-hd'].includes(model.modelKey) || model.providerModelKey !== 'h3-video')) {
    throw new Error('Review H3-only channel contents before syncing');
  }
  const jobs = (await api('/admin/channel-sync')).jobs;
  const job = jobs.find(item => item.channelId === channel.id)?.job;
  if (!job || job.script !== 'model-plaza' || job.sourceUrl !== SOURCE_URL || job.groupId !== 100 || !job.syncPrices || job.importNew) {
    throw new Error('H3 synchronization must use reviewed group 100 with imports disabled');
  }
  const run = (await api(`/admin/channel-sync/${channel.id}/run`, 'POST')).run;
  console.log(JSON.stringify({ channelId: channel.id, runId: run.id, status: run.status, schedule: '*/30 * * * * Asia/Shanghai' }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`H3 setup/sync failed: ${error.message}`); process.exitCode = 1; });
}
