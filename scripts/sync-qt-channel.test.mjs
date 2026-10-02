import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildPlan as planForAuthorizedModels, buildSQL, CHANNEL_ID, CHANNEL_NAME, decryptChannelKey, SNAPSHOT_SQL, toMicrocredits } from './sync-qt-channel.mjs';

function buildPlan(catalog, snapshot, authorized = catalog.data.groups[0].models.map(model => model.name)) {
  return planForAuthorizedModels(catalog, snapshot, authorized);
}

function fixture() {
  const upstream = { name: 'test-video', description: 'Updated description', pricing: {
    billing_mode: 'video', per_request_price: null,
    intervals: [{ tier_label: '720p', min_tokens: 0, max_tokens: null, per_request_price: 0.297 }],
  } };
  const catalog = { code: 0, data: { groups: [{ id: 83, name: '万有引力图片视频组',
    rate_multiplier: 1, peak_rate_enabled: false, image_rate_independent: false, models: [upstream] }] } };
  const model = { id: 'MODEL_TEST', channel_id: CHANNEL_ID, model_key: upstream.name,
    provider_model_key: upstream.name, description: 'Old description', enabled: true,
    capability: 'video', capability_config_json: '{"version":1,"video":{}}', price_configured: true,
    billing_mode: 'per_second', unit_price_microcredits: 120_000, price_version: 1 };
  const tier = { id: 'TIER_TEST', channel_model_id: model.id, provider_model_key: model.model_key,
    enabled: true, price_configured: true, cost_configured: true, price_version: 1,
    billing_mode: 'per_second', selector_json: '{"vquality":"720p"}', resolution: '720p',
    video_seconds: 0, unit_price_microcredits: 120_000, cost_unit_price_microcredits: 100_000,
    input_token_price_microcredits: 0, output_token_price_microcredits: 0,
    cached_token_price_microcredits: 0, cost_input_token_price_microcredits: 0,
    cost_output_token_price_microcredits: 0, cost_cached_token_price_microcredits: 0 };
  const snapshot = { channel: { id: CHANNEL_ID, name: CHANNEL_NAME, scope: 'system', enabled: true },
    models: [model], tiers: [tier] };
  return { catalog, upstream, snapshot, model, tier };
}

test('decimal pricing converts exactly and rejects missing or sub-microcredit values', () => {
  assert.equal(toMicrocredits(0.297), 297_000);
  assert.equal(toMicrocredits(0.000001), 1);
  assert.equal(toMicrocredits(0), 0);
  for (const value of [null, undefined, '0.1', NaN, Infinity, -1, 0.0000001, 1e20]) {
    assert.throws(() => toMicrocredits(value));
  }
});

test('sync updates costs, applies a 20% markup, and synchronizes the model summary', () => {
  const f = fixture();
  const plan = buildPlan(f.catalog, f.snapshot);
  assert.equal(plan.tiers[0].cost, 297_000);
  assert.equal(plan.tiers[0].sale, 356_400);
  assert.equal(plan.models[0].sale, 356_400);
  assert.equal(plan.models[0].description, 'Updated description');
  assert.equal(plan.models[0].priceChanged, true);
  assert.equal(f.tier.unit_price_microcredits, 120_000);
});

test('fractional markup rounds up to a microcredit', () => {
  const f = fixture();
  f.upstream.pricing.intervals[0].per_request_price = 0.000001;
  assert.equal(buildPlan(f.catalog, f.snapshot).tiers[0].sale, 2);
});

test('identical upstream data produces no price or description writes', () => {
  const f = fixture();
  f.tier.cost_unit_price_microcredits = 297_000;
  f.tier.unit_price_microcredits = f.model.unit_price_microcredits = 356_400;
  f.model.description = f.upstream.description;
  const plan = buildPlan(f.catalog, f.snapshot);
  assert.deepEqual(plan.models, []);
  assert.deepEqual(plan.tiers, []);
});

test('wrong channel, group, duplicated model, and changed multipliers fail closed', () => {
  for (const change of [
    f => { f.snapshot.channel.id = 'OTHER'; },
    f => { f.snapshot.channel.scope = 'user'; },
    f => { f.catalog.data.groups[0].name = 'OTHER'; },
    f => { f.catalog.data.groups[0].models.push(f.upstream); },
    f => { f.catalog.data.groups[0].rate_multiplier = 1.5; },
    f => { f.catalog.data.groups[0].peak_rate_enabled = true; },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => buildPlan(f.catalog, f.snapshot));
  }
});

test('absent, duplicate, and invalid upstream price tiers cannot change prices', () => {
  for (const change of [
    f => { f.upstream.pricing.intervals[0].tier_label = '1080p'; },
    f => { f.upstream.pricing.intervals.push(f.upstream.pricing.intervals[0]); },
    f => { f.upstream.pricing.intervals[0].per_request_price = null; },
    f => { f.upstream.pricing.billing_mode = 'per_request'; },
    f => { f.tier.selector_json = '{"videoSeconds":"10"}'; },
    f => { f.tier.cost_configured = false; },
    f => { f.upstream.time_pricing = { periods: [] }; },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => buildPlan(f.catalog, f.snapshot));
  }
});

test('wildcard image prices require identical costs across all upstream qualities', () => {
  const f = fixture();
  f.upstream.pricing.billing_mode = 'image';
  f.model.capability = 'image';
  f.model.capability_config_json = '{"version":1,"image":{}}';
  f.model.billing_mode = f.tier.billing_mode = 'fixed_request';
  f.tier.selector_json = '{}';
  f.tier.resolution = '*';
  f.upstream.pricing.intervals = ['1K', '2K', '4K'].map(tier_label => ({
    tier_label, min_tokens: 0, max_tokens: null, per_request_price: 0.165,
  }));
  assert.equal(buildPlan(f.catalog, f.snapshot).tiers[0].cost, 165_000);
  f.upstream.pricing.intervals[2].per_request_price = 0.33;
  assert.throws(() => buildPlan(f.catalog, f.snapshot), /different upstream quality prices/);
});

test('empty or contradictory descriptions preserve existing text without blocking valid prices', () => {
  for (const description of [undefined, '', '按次计费']) {
    const f = fixture();
    f.upstream.description = description;
    const plan = buildPlan(f.catalog, f.snapshot);
    assert.equal(plan.models[0].description, 'Old description');
    assert.equal(plan.tiers[0].cost, 297_000);
    assert.equal(plan.warnings.length, 1);
  }
});

test('an enabled model missing upstream blocks the whole batch; disabled records are preserved', () => {
  const f = fixture();
  f.snapshot.models.push({ ...f.model, id: 'OTHER', model_key: 'retired-model' });
  assert.throws(() => buildPlan(f.catalog, f.snapshot), /enabled model is missing upstream/);
  f.snapshot.models[1].enabled = false;
  const plan = buildPlan(f.catalog, f.snapshot);
  assert.equal(plan.models.length, 1);
  assert.equal(plan.warnings.length, 1);
});

test('costs use the tier provider SKU and descriptions use the channel model key', () => {
  const f = fixture();
  f.catalog.data.groups[0].models.push({ ...f.upstream, name: 'provider-sku', pricing: {
    ...f.upstream.pricing, intervals: [{ ...f.upstream.pricing.intervals[0], per_request_price: 0.55 }],
  } });
  f.tier.provider_model_key = 'provider-sku';
  const plan = buildPlan(f.catalog, f.snapshot);
  assert.equal(plan.tiers[0].cost, 550_000);
  assert.equal(plan.models[0].description, f.upstream.description);
});

test('authorized existing models are enabled and unauthorized models are disabled', () => {
  const f = fixture();
  f.model.enabled = false;
  const plan = buildPlan(f.catalog, f.snapshot);
  assert.equal(plan.models[0].enabled, true);
  assert.deepEqual(plan.enabledModels, ['test-video']);
  assert.equal(plan.syncChannelModels, true);
  f.model.enabled = true;
  const disabled = buildPlan(f.catalog, f.snapshot, ['unpriced-other-model']);
  assert.equal(disabled.models[0].enabled, false);
  assert.deepEqual(disabled.missingPriceModels, ['unpriced-other-model']);
  for (const list of [undefined, [], ['test-video', 'test-video']]) {
    assert.throws(() => planForAuthorizedModels(f.catalog, f.snapshot, list));
  }
});

test('a configured model missing all price tiers gets explicit upstream tiers before enabling', () => {
  const f = fixture();
  f.model.enabled = false;
  f.model.price_configured = false;
  f.snapshot.tiers[0].channel_model_id = 'OTHER';
  f.snapshot.sequences = [{ name: 'id:MODEL', value: 100 }, { name: 'id:PTIER', value: 200 }];
  const plan = buildPlan(f.catalog, f.snapshot);
  assert.equal(plan.newTiers.length, 1);
  assert.equal(plan.newTiers[0].id, 'PTIER_000201');
  assert.equal(plan.models[0].enabled, true);
  assert.equal(plan.models[0].configured, true);
  assert.equal(plan.tiers[0].cost, 297_000);
  assert.deepEqual(plan.sequences, [{ name: 'id:PTIER', value: 201 }]);
});

test('unknown protocol profiles remain unimported with a diagnostic', () => {
  const f = fixture();
  f.catalog.data.groups[0].models.push({ ...f.upstream, name: 'new-unknown-model' });
  const plan = buildPlan(f.catalog, f.snapshot);
  assert.deepEqual(plan.newModels, []);
  assert.deepEqual(plan.upstreamOnlyModels, ['new-unknown-model']);
  assert.match(plan.warnings[0], /missing protocol\/capability profile/);
});

test('channel credential decryption verifies the GCM tag and rejects a changed settings key', () => {
  const key = Buffer.alloc(32, 7), nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const payload = Buffer.concat([nonce, cipher.update('synthetic-test-credential'), cipher.final(), cipher.getAuthTag()]);
  const encrypted = `enc:v1:${payload.toString('base64')}`;
  assert.equal(decryptChannelKey(encrypted, key), 'synthetic-test-credential');
  assert.throws(() => decryptChannelKey(encrypted, Buffer.alloc(32, 8)));
  payload[payload.length - 1] ^= 1;
  assert.throws(() => decryptChannelKey(`enc:v1:${payload.toString('base64')}`, key));
});

test('PostgreSQL transaction rolls back, commits idempotently, and rejects concurrent edits', {
  skip: !process.env.QT_SYNC_TEST_BACKUP,
}, () => {
  const directory = process.env.QT_SYNC_TEST_BACKUP;
  const snapshot = JSON.parse(readFileSync(join(directory, 'before.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(directory, 'upstream.json'), 'utf8'));
  const authorized = JSON.parse(readFileSync(join(directory, 'authorized-models.json'), 'utf8'));
  const plan = buildPlan(catalog, snapshot, authorized);
  assert.ok(plan.models.length + plan.tiers.length > 0, 'Fixture must include a real update');
  const encoded = Buffer.from(JSON.stringify(snapshot)).toString('base64');
  // All mutations stay in connection-local temporary tables; production rows are only read for table definitions.
  const seed = `CREATE TEMP TABLE model_channels (LIKE public.model_channels INCLUDING DEFAULTS);
CREATE TEMP TABLE channel_models (LIKE public.channel_models INCLUDING DEFAULTS);
CREATE TEMP TABLE channel_model_price_tiers (LIKE public.channel_model_price_tiers INCLUDING DEFAULTS);
CREATE TEMP TABLE id_sequences (LIKE public.id_sequences INCLUDING DEFAULTS);
CREATE TEMP TABLE qt_test_fixture (data jsonb);
INSERT INTO qt_test_fixture VALUES (convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb);
INSERT INTO model_channels (id, name, scope, enabled, updated_at, base_url, models_json)
SELECT c.id, c.name, c.scope, c.enabled, c.updated_at, c.base_url, c.models_json FROM
jsonb_to_record((SELECT data->'channel' FROM qt_test_fixture))
AS c(id text, name text, scope text, enabled boolean, updated_at timestamptz, base_url text, models_json text);
INSERT INTO channel_models SELECT * FROM jsonb_populate_recordset(NULL::channel_models,
(SELECT data->'models' FROM qt_test_fixture));
INSERT INTO channel_model_price_tiers SELECT * FROM jsonb_populate_recordset(NULL::channel_model_price_tiers,
(SELECT data->'tiers' FROM qt_test_fixture));
INSERT INTO id_sequences SELECT * FROM jsonb_populate_recordset(NULL::id_sequences,
(SELECT data->'sequences' FROM qt_test_fixture));
`;
  function sql(input) {
    return spawnSync('docker', ['compose', '--env-file', '.env', '-f', 'docker-compose.deploy.yml',
      'exec', '-T', 'postgres', 'sh', '-c',
      'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], {
      input: seed + input, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
  }
  const dryRun = sql(`${buildSQL(snapshot, plan, false)}${SNAPSHOT_SQL};`);
  assert.equal(dryRun.status, 0, 'Temporary-table dry-run should succeed');
  assert.deepEqual(JSON.parse(dryRun.stdout.trim()), snapshot);
  const applied = sql(`${buildSQL(snapshot, plan, true)}${SNAPSHOT_SQL};`);
  assert.equal(applied.status, 0, 'Temporary-table commit should succeed');
  const after = JSON.parse(applied.stdout.trim());
  assert.equal(after.models.length, snapshot.models.length + plan.newModels.length);
  assert.equal(after.tiers.length, snapshot.tiers.length + plan.newTiers.length);
  for (const sequence of plan.sequences) {
    assert.equal(after.sequences.find(row => row.name === sequence.name).value, sequence.value);
  }
  const repeated = buildPlan(catalog, after, authorized);
  assert.deepEqual(repeated.models, []);
  assert.deepEqual(repeated.tiers, []);
  for (const old of snapshot.models) {
    const current = after.models.find(item => item.id === old.id);
    const change = plan.models.find(item => item.id === old.id);
    assert.equal(current.enabled, change?.enabled ?? old.enabled);
    assert.equal(current.price_version, old.price_version + (change?.versionChanged ? 1 : 0));
  }
  const conflict = sql(`UPDATE channel_models SET description = description || ' concurrent edit';
${buildSQL(snapshot, plan, true)}`);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /QT channel changed after snapshot/);
  const invalid = { ...plan, tiers: [...plan.tiers, { id: 'MISSING_TIER', cost: 1, sale: 2 }] };
  const rejected = sql(buildSQL(snapshot, invalid, true));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /QT channel sync verification failed/);
});
