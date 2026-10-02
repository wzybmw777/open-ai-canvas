import { spawnSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareModels } from './qt-channel-models.mjs';
import { auditCapabilities } from './qt-channel-capabilities.mjs';

export const CHANNEL_ID = 'CHANNEL_000014';
export const CHANNEL_NAME = 'QT中转-2';
export const SOURCE_URL = 'https://api.qtrader.cc/api/v1/model-plaza';
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = ['compose', '--env-file', '.env', '-f', 'docker-compose.deploy.yml'];
const MAX_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

// Public catalog prices use credits per request/second; one credit is 1,000,000 microcredits.
export function toMicrocredits(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Missing or invalid upstream price');
  }
  const [, whole, fraction = '', exponent = '0'] = String(value).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  const digits = BigInt(whole + fraction);
  const shift = 6 + Number(exponent) - fraction.length;
  const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n;
  if (digits % divisor !== 0n) throw new Error('Upstream price is smaller than one microcredit');
  const result = shift < 0 ? digits / divisor : digits * 10n ** BigInt(shift);
  if (result > MAX_INTEGER) throw new Error('Upstream price exceeds safe integer range');
  return Number(result);
}

function salePrice(cost) {
  const result = (BigInt(cost) * 120n + 99n) / 100n;
  if (result > MAX_INTEGER) throw new Error('Sale price exceeds safe integer range');
  return Number(result);
}

function catalogModels(catalog) {
  if (catalog?.code !== 0 || !Array.isArray(catalog.data?.groups)) {
    throw new Error('Upstream did not return a successful model catalog');
  }
  const groups = catalog.data.groups.filter(group => group.id === 83 && group.name === '万有引力图片视频组');
  if (groups.length !== 1 || !Array.isArray(groups[0].models) || groups[0].models.length === 0) {
    throw new Error('Upstream pricing group is missing or ambiguous');
  }
  const group = groups[0];
  if (group.rate_multiplier !== 1 || group.peak_rate_enabled !== false ||
      (group.image_rate_independent && group.image_rate_multiplier !== 1)) {
    throw new Error('Upstream group multiplier or peak pricing requires manual review');
  }
  const result = new Map();
  for (const item of group.models) {
    if (typeof item.name !== 'string' || !item.name.trim() || result.has(item.name)) {
      throw new Error('Invalid or duplicate upstream model name');
    }
    result.set(item.name, item);
  }
  return result;
}

function tierCost(upstream, tier, capability) {
  const pricing = upstream.pricing;
  const mode = { video: 'per_second', image: 'fixed_request', per_request: 'fixed_request' }[pricing?.billing_mode];
  if (!mode || mode !== tier.billing_mode || upstream.time_pricing ||
      (pricing.billing_mode === 'video' && capability !== 'video') ||
      (pricing.billing_mode === 'image' && capability !== 'image')) {
    throw new Error(`${upstream.name}: billing mode or time pricing requires manual review`);
  }
  const selector = JSON.parse(tier.selector_json);
  if (!selector || Array.isArray(selector) || typeof selector !== 'object' || tier.video_seconds !== 0 ||
      Object.entries(selector).some(([key, value]) =>
        !['quality', 'vquality', 'operation'].includes(key) || typeof value !== 'string')) {
    throw new Error(`${upstream.name}: unsupported local price selector`);
  }
  if (selector.quality && selector.vquality) throw new Error(`${upstream.name}: ambiguous price selector`);
  if (['input_token_price_microcredits', 'output_token_price_microcredits', 'cached_token_price_microcredits',
       'cost_input_token_price_microcredits', 'cost_output_token_price_microcredits',
       'cost_cached_token_price_microcredits'].some(key => tier[key] !== 0)) {
    throw new Error(`${upstream.name}: unexpected local token pricing`);
  }
  if (!Array.isArray(pricing.intervals)) throw new Error(`${upstream.name}: upstream price tiers are missing`);
  if (pricing.intervals.length === 0) return toMicrocredits(pricing.per_request_price);
  const quality = selector.quality || selector.vquality;
  if (!quality) {
    // A legacy wildcard tier is unambiguous only while every upstream quality costs the same.
    const prices = pricing.intervals.map(item => {
      if (typeof item.tier_label !== 'string' || !item.tier_label ||
          item.min_tokens !== 0 || item.max_tokens !== null) {
        throw new Error(`${upstream.name}: unsupported wildcard upstream tiers`);
      }
      return toMicrocredits(item.per_request_price);
    });
    if (new Set(prices).size !== 1) throw new Error(`${upstream.name}: wildcard tier has different upstream quality prices`);
    return prices[0];
  }
  const matches = pricing.intervals.filter(item =>
    typeof item.tier_label === 'string' && item.tier_label.toLowerCase() === quality.toLowerCase());
  if (matches.length !== 1 || matches[0].min_tokens !== 0 || matches[0].max_tokens !== null) {
    throw new Error(`${upstream.name}: missing or ambiguous upstream tier ${quality}`);
  }
  return toMicrocredits(matches[0].per_request_price);
}

export function buildPlan(catalog, snapshot, authorizedKeys) {
  const channel = snapshot?.channel;
  if (channel?.id !== CHANNEL_ID || channel.name !== CHANNEL_NAME || channel.scope !== 'system' ||
      channel.enabled !== true || !Array.isArray(snapshot.models) || snapshot.models.length === 0 ||
      !Array.isArray(snapshot.tiers)) {
    throw new Error('Target channel identity or model snapshot is invalid');
  }
  const upstreamModels = catalogModels(catalog);
  if (!Array.isArray(authorizedKeys) || authorizedKeys.length === 0 ||
      authorizedKeys.some(key => typeof key !== 'string' || !key.trim()) ||
      new Set(authorizedKeys).size !== authorizedKeys.length) {
    throw new Error('A nonempty, unambiguous authorized model catalog is required');
  }
  const authorized = new Set(authorizedKeys);
  const prepared = prepareModels(upstreamModels, snapshot, authorized);
  const plan = { channelId: CHANNEL_ID, markupPercent: 20, matchedModels: 0, matchedTiers: 0,
    models: [], tiers: [], warnings: prepared.warnings, upstreamOnlyModels: [],
    newModels: prepared.newModels, newTiers: prepared.newTiers, sequences: prepared.sequences,
    enabledModels: [], disabledModels: [], missingPriceModels: authorizedKeys.filter(key => !upstreamModels.has(key)) };
  const localKeys = new Set(prepared.models.map(model => model.model_key));
  plan.upstreamOnlyModels = [...upstreamModels.keys()].filter(key => !localKeys.has(key));
  for (const model of prepared.models) {
    const upstream = upstreamModels.get(model.model_key);
    if (!upstream) {
      if (model.enabled) throw new Error(`${model.model_key}: enabled model is missing upstream`);
      plan.warnings.push(`${model.model_key}: disabled model is missing upstream, retained`);
      continue;
    }
    plan.matchedModels++;
    const tiers = prepared.tiers.filter(tier => tier.channel_model_id === model.id);
    const enabled = authorized.has(model.provider_model_key) &&
      tiers.some(tier => tier.enabled && tier.price_configured && tier.cost_configured) &&
      tiers.filter(tier => tier.enabled).every(tier => authorized.has(tier.provider_model_key || model.provider_model_key));
    if (enabled) {
      const config = JSON.parse(model.capability_config_json);
      if (config.version !== 1 || !config[model.capability]) throw new Error(`${model.model_key}: invalid capability config`);
    }
    if (enabled && !model.enabled) plan.enabledModels.push(model.model_key);
    if (!enabled && model.enabled) plan.disabledModels.push(model.model_key);
    const costs = new Map();
    for (const tier of tiers.filter(tier => tier.enabled)) {
      if (!tier.price_configured || !tier.cost_configured || tier.price_version < 1) {
        throw new Error(`${model.model_key}: tier pricing is not configured`);
      }
      const providerKey = tier.provider_model_key || model.provider_model_key;
      const provider = upstreamModels.get(providerKey);
      if (!provider) throw new Error(`${model.model_key}: provider SKU ${providerKey} is missing upstream`);
      const cost = tierCost(provider, tier, model.capability);
      const sale = salePrice(cost);
      costs.set(tier.id, sale);
      plan.matchedTiers++;
      if (tier.cost_unit_price_microcredits !== cost || tier.unit_price_microcredits !== sale) {
        plan.tiers.push({ id: tier.id, modelId: model.id, modelKey: model.model_key,
          selector: JSON.parse(tier.selector_json), cost, sale });
      }
    }
    let description = model.description;
    if (typeof upstream.description === 'string' && upstream.description.trim()) {
      const proposed = upstream.description.trim();
      if ([...proposed].length > 500) throw new Error(`${model.model_key}: description exceeds 500 characters`);
      const mode = { video: 'per_second', image: 'fixed_request', per_request: 'fixed_request' }[upstream.pricing?.billing_mode];
      if ((mode === 'per_second' && /按次计费/.test(proposed)) ||
          (mode === 'fixed_request' && /按秒计费/.test(proposed))) {
        plan.warnings.push(`${model.model_key}: description contradicts structured billing, retained`);
      } else {
        description = proposed;
      }
    } else {
      plan.warnings.push(`${model.model_key}: upstream description is empty, retained`);
    }
    const priceChanged = plan.tiers.some(tier => tier.modelId === model.id);
    let sale = model.unit_price_microcredits;
    const configured = tiers.some(tier => tier.enabled && tier.price_configured);
    let billing = model.billing_mode;
    if (priceChanged || configured !== model.price_configured) {
      // Match the app's summary rule: first sorted tier, preferring a wildcard tier.
      const summary = tiers.reduce((selected, tier) =>
        !selected || (tier.resolution === '*' && tier.video_seconds === 0) ? tier : selected, null);
      if (summary && costs.has(summary.id)) { sale = costs.get(summary.id); billing = summary.billing_mode; }
    }
    const versionChanged = priceChanged || enabled !== model.enabled || configured !== model.price_configured;
    if (versionChanged || description !== model.description) {
      if (model.price_version < 1) throw new Error(`${model.model_key}: invalid model price version`);
      plan.models.push({ id: model.id, modelKey: model.model_key, description, sale, priceChanged,
        enabled, configured, billing, versionChanged });
    }
  }
  if (plan.matchedTiers === 0) throw new Error('No existing price tiers matched upstream');
  const capabilityAudit = auditCapabilities(catalog, { models: prepared.models });
  for (const item of capabilityAudit.models) {
    if (item.differences.length) plan.warnings.push(`${item.model}: capability mismatch (${item.differences.map(change => change.field).join(', ')}); run the capability audit`);
    if (item.pending.some(message => message.includes('介绍已变化'))) plan.warnings.push(`${item.model}: upstream capability description changed; reviewed rules require review`);
  }
  // Preserve unresolved findings across nightly runs; price sync never guesses capabilities.
  plan.capabilityAudit = capabilityAudit;
  plan.syncChannelModels = plan.newModels.length > 0 || plan.enabledModels.length > 0 || plan.disabledModels.length > 0;
  return plan;
}

export const SNAPSHOT_SQL = `SELECT jsonb_build_object(
  'channel', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'scope', c.scope,
    'enabled', c.enabled, 'updated_at', c.updated_at, 'base_url', c.base_url, 'models_json', c.models_json)
    FROM model_channels c WHERE c.id = '${CHANNEL_ID}' AND c.deleted_at IS NULL),
  'models', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb)
    FROM channel_models m WHERE m.channel_id = '${CHANNEL_ID}' AND m.deleted_at IS NULL),
  'tiers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.selector_key, t.created_at, t.id), '[]'::jsonb)
    FROM channel_model_price_tiers t JOIN channel_models m ON m.id = t.channel_model_id
    WHERE m.channel_id = '${CHANNEL_ID}' AND m.deleted_at IS NULL AND t.deleted_at IS NULL),
  'sequences', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.name), '[]'::jsonb)
    FROM id_sequences s WHERE s.name IN ('id:MODEL', 'id:PTIER')))`;

export function buildSQL(snapshot, plan, apply) {
  const encoded = Buffer.from(JSON.stringify({ snapshot, plan })).toString('base64');
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE model_channels, channel_models, channel_model_price_tiers, id_sequences IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE qt_sync_payload (data jsonb) ON COMMIT DROP;
INSERT INTO qt_sync_payload VALUES (convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb);
DO $$
BEGIN
  IF (${SNAPSHOT_SQL}) IS DISTINCT FROM (SELECT data->'snapshot' FROM qt_sync_payload) THEN
    RAISE EXCEPTION 'QT channel changed after snapshot; retry with fresh data';
  END IF;
END $$;
UPDATE id_sequences s SET value = p.value, updated_at = now()
FROM jsonb_to_recordset((SELECT data->'plan'->'sequences' FROM qt_sync_payload)) AS p(name text, value bigint)
WHERE s.name = p.name;
INSERT INTO channel_models SELECT * FROM jsonb_populate_recordset(NULL::channel_models,
  (SELECT data->'plan'->'newModels' FROM qt_sync_payload));
INSERT INTO channel_model_price_tiers SELECT * FROM jsonb_populate_recordset(NULL::channel_model_price_tiers,
  (SELECT data->'plan'->'newTiers' FROM qt_sync_payload));
UPDATE channel_model_price_tiers t SET
  cost_unit_price_microcredits = p.cost, unit_price_microcredits = p.sale,
  price_version = t.price_version + CASE WHEN t.id IN
    (SELECT value->>'id' FROM qt_sync_payload, jsonb_array_elements(data->'plan'->'newTiers')) THEN 0 ELSE 1 END,
  updated_at = now()
FROM jsonb_to_recordset((SELECT data->'plan'->'tiers' FROM qt_sync_payload)) AS p(id text, cost bigint, sale bigint)
WHERE t.id = p.id AND t.deleted_at IS NULL;
UPDATE channel_models m SET description = p.description, unit_price_microcredits = p.sale,
  enabled = p.enabled, price_configured = p.configured, billing_mode = p.billing,
  price_version = m.price_version + CASE WHEN p."versionChanged" AND m.id NOT IN
    (SELECT value->>'id' FROM qt_sync_payload, jsonb_array_elements(data->'plan'->'newModels')) THEN 1 ELSE 0 END,
  updated_at = now()
FROM jsonb_to_recordset((SELECT data->'plan'->'models' FROM qt_sync_payload))
  AS p(id text, description text, sale bigint, enabled boolean, configured boolean, billing text, "versionChanged" boolean)
WHERE m.id = p.id AND m.channel_id = '${CHANNEL_ID}' AND m.deleted_at IS NULL;
UPDATE model_channels c SET models_json = (
  SELECT coalesce(jsonb_agg(m.model_key ORDER BY m.sort_order, m.created_at, m.id)::text, '[]')
  FROM channel_models m WHERE m.channel_id=c.id AND m.enabled AND m.deleted_at IS NULL), updated_at=now()
WHERE c.id='${CHANNEL_ID}' AND (SELECT (data->'plan'->>'syncChannelModels')::boolean FROM qt_sync_payload);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset((SELECT data->'plan'->'tiers' FROM qt_sync_payload)) AS p(id text, cost bigint, sale bigint)
    LEFT JOIN channel_model_price_tiers t ON t.id = p.id
    WHERE t.id IS NULL OR t.cost_unit_price_microcredits <> p.cost OR t.unit_price_microcredits <> p.sale
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset((SELECT data->'plan'->'models' FROM qt_sync_payload))
      AS p(id text, description text, sale bigint, enabled boolean, configured boolean, billing text)
    LEFT JOIN channel_models m ON m.id = p.id
    WHERE m.id IS NULL OR m.description <> p.description OR m.unit_price_microcredits <> p.sale
      OR m.enabled <> p.enabled OR m.price_configured <> p.configured OR m.billing_mode <> p.billing
  ) THEN RAISE EXCEPTION 'QT channel sync verification failed'; END IF;
END $$;
${apply ? 'COMMIT' : 'ROLLBACK'};
`;
}

function command(program, args, input) {
  const result = spawnSync(program, args, { cwd: ROOT_DIR, input, encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (result.error || result.status !== 0) {
    // Compose diagnostics can contain resolved secrets, so only report the exit status.
    const knownError = ['QT channel changed after snapshot; retry with fresh data',
      'QT channel sync verification failed', 'canceling statement due to lock timeout',
      'canceling statement due to statement timeout'].find(message => result.stderr?.includes(message));
    if (knownError) throw new Error(knownError);
    throw new Error(`${program} failed (status ${result.status ?? 'unavailable'}); check the local run result`);
  }
  return result.stdout;
}

function database(sql) {
  return command('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'sh', '-c',
    'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], sql);
}

function saveJSON(directory, filename, data) {
  writeFileSync(join(directory, filename), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

export function decryptChannelKey(value, key) {
  if (typeof value !== 'string' || !value) throw new Error('Missing channel credential');
  if (!value.startsWith('enc:v1:')) return value;
  if (key.length !== 32) throw new Error('Invalid settings key');
  const payload = Buffer.from(value.slice(7), 'base64');
  if (payload.length < 28) throw new Error('Invalid encrypted channel credential');
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(-16));
  return Buffer.concat([decipher.update(payload.subarray(12, -16)), decipher.final()]).toString('utf8');
}

async function authorizedModels(snapshot) {
  const channel = JSON.parse(database(`SELECT jsonb_build_object('apiKey', api_key, 'baseUrl', base_url)
    FROM model_channels WHERE id='${CHANNEL_ID}' AND scope='system' AND deleted_at IS NULL;`));
  const endpoint = new URL(channel.baseUrl.replace(/\/$/, '') + '/v1/models');
  if (channel.baseUrl !== snapshot.channel.base_url || endpoint.protocol !== 'https:' ||
      endpoint.hostname !== 'sub2.echoai.best' || endpoint.search || endpoint.username || endpoint.password) {
    throw new Error('Unexpected QT channel endpoint');
  }
  const key = channel.apiKey?.startsWith('enc:v1:')
    ? Buffer.from(command('docker', [...COMPOSE, 'exec', '-T', 'backend', 'base64', '/data/.settings-key']), 'base64')
    : Buffer.alloc(0);
  let apiKey;
  try { apiKey = decryptChannelKey(channel.apiKey, key); }
  catch { throw new Error('Channel credential could not be decrypted'); }
  let response;
  try { response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Authorized QT model catalog request failed'); }
  if (!response.ok) throw new Error(`Authorized QT model catalog returned HTTP ${response.status}`);
  let body;
  try { body = await response.json(); }
  catch { throw new Error('Invalid authorized QT model catalog'); }
  if (!Array.isArray(body.data)) throw new Error('Invalid authorized QT model catalog');
  return body.data.map(model => model.id);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--apply', '--dry-run', '--help'].includes(args[0]))) {
    throw new Error('Usage: bash scripts/sync-qt-channel.sh [--dry-run|--apply]');
  }
  if (args[0] === '--help') {
    console.log('Usage: bash scripts/sync-qt-channel.sh [--dry-run|--apply]\nDefault: dry-run; sale = upstream cost * 120%, rounded up to microcredits.');
    return;
  }
  process.umask(0o077);
  const apply = args[0] === '--apply';
  const catalog = JSON.parse(command('curl', ['--fail', '--silent', '--show-error', '--proto', '=https',
    '--connect-timeout', '10', '--max-time', '30', '--retry', '2', '--retry-delay', '2', SOURCE_URL]));
  const snapshot = JSON.parse(database(`${SNAPSHOT_SQL};\n`));
  const authorized = await authorizedModels(snapshot);
  const plan = buildPlan(catalog, snapshot, authorized);
  const backupDirectory = join(ROOT_DIR, '.local', 'backups', 'qt-channel-sync',
    `${new Date().toISOString().replaceAll(':', '-')}--${apply ? 'apply' : 'dry-run'}-${process.pid}`);
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  saveJSON(backupDirectory, 'before.json', snapshot);
  saveJSON(backupDirectory, 'upstream.json', catalog);
  saveJSON(backupDirectory, 'authorized-models.json', authorized);
  saveJSON(backupDirectory, 'plan.json', plan);
  const sql = buildSQL(snapshot, plan, apply);
  writeFileSync(join(backupDirectory, 'transaction.sql'), sql, { mode: 0o600, flag: 'wx' });
  database(sql);
  saveJSON(backupDirectory, 'result.json', { status: apply ? 'committed' : 'rolled_back',
    finishedAt: new Date().toISOString(), changedModels: plan.models.length, changedTiers: plan.tiers.length,
    importedModels: plan.newModels.length, addedTiers: plan.newTiers.length, enabledModels: plan.enabledModels });
  if (apply) {
    command('docker', [...COMPOSE, 'exec', '-T', 'redis', 'redis-cli', 'INCR',
      'canvas:logical-model-route-catalog:version']);
  }
  for (const warning of plan.warnings) console.warn(`WARNING: ${warning}`);
  console.log(JSON.stringify({ status: apply ? 'updated' : 'dry-run', channel: CHANNEL_NAME,
    matchedModels: plan.matchedModels, matchedTiers: plan.matchedTiers,
    changedModels: plan.models.length, changedTiers: plan.tiers.length,
    importedModels: plan.newModels.length, addedTiers: plan.newTiers.length, enabledModels: plan.enabledModels,
    missingPriceModels: plan.missingPriceModels, upstreamOnlyModels: plan.upstreamOnlyModels, backupDirectory }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`QT sync failed: ${error.message}`); process.exitCode = 1; });
}
