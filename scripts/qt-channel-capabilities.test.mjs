import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { auditCapabilities, capabilityAuditSQL } from './qt-channel-capabilities.mjs';
import { SNAPSHOT_SQL } from './sync-qt-channel.mjs';

function fixture(key = 'wan30-720p', description = '4–30 秒，带参考视频时 4–15 秒；10 图、5 视频、5 音频') {
  const config = { version: 1, video: { references: { minImages: 0, maxImages: 10, maxVideos: 0, maxAudios: 0 },
    operations: ['text_to_video', 'image_to_video'], duration: { selection: 'range', min: 1, max: 15, step: 1, default: 6 },
    resolutions: ['720p'], defaultResolution: '720p', ratios: ['16:9'], defaultRatio: '16:9' } };
  const model = { id: 'MODEL_TEST', model_key: key, capability: 'video', protocol: 'lxmone-wan-videos',
    capability_version: 1, capability_config_json: JSON.stringify(config) };
  return { config, model, snapshot: { models: [model] }, catalog: { code: 0, data: { groups: [
    { id: 83, name: '万有引力图片视频组', models: [{ name: key, description }] }] } } };
}

test('Wan restores mixed references and preserves the conditional 15-second video-reference cap', () => {
  const f = fixture();
  const report = auditCapabilities(f.catalog, f.snapshot);
  const video = JSON.parse(report.changes[0].after).video;
  assert.equal(video.references.maxVideos, 5);
  assert.equal(video.references.maxAudios, 5);
  assert.ok(video.operations.includes('reference_to_video'));
  assert.equal(video.duration.min, 4);
  assert.equal(video.duration.max, 30);
  assert.equal(video.duration.maxWithReferenceVideo, 15);
  assert.equal(JSON.parse(f.model.capability_config_json).video.references.maxVideos, 0);
  const repeated = auditCapabilities(f.catalog, { models: [{ ...f.model, capability_config_json: report.changes[0].after }] });
  assert.equal(repeated.changes.length, 0);
});

test('explicit no-video contract removes video inputs but preserves multi-image operation', () => {
  const f = fixture('sd-2.5-720p-ultra', '30-0-10 5秒-30秒');
  f.config.video.references.maxVideos = 10;
  f.model.capability_config_json = JSON.stringify(f.config);
  const video = JSON.parse(auditCapabilities(f.catalog, f.snapshot).changes[0].after).video;
  assert.equal(video.references.maxVideos, 0);
  assert.equal(video.references.maxImages, 30);
  assert.ok(video.operations.includes('reference_to_video'));
});

test('fixed 15 seconds replaces a broad range without inheriting contradictory reference limits', () => {
  const f = fixture('seedance2.0-fast', '9-0-0 固定 15 秒');
  const video = JSON.parse(auditCapabilities(f.catalog, f.snapshot).changes[0].after).video;
  assert.deepEqual(video.duration, { selection: 'enum', values: [15], default: 15 });
  assert.equal(video.references.maxVideos, 0);
  assert.equal(video.references.maxAudios, 0);
});

test('changed upstream evidence invalidates reviewed rules instead of guessing', () => {
  const f = fixture('wan30-720p', '全模态无限制，新渠道');
  const report = auditCapabilities(f.catalog, f.snapshot);
  assert.equal(report.changes.length, 0);
  assert.match(report.models[0].pending.join(' '), /介绍已变化/);
});

test('multi-image canvas mode is distinct from accepting reference video', () => {
  const f = fixture('minimax-h3-b', '必须上传 1-9 张参考图，1-15 秒');
  f.config.video.references.minImages = 1;
  f.config.video.references.maxImages = 9;
  f.config.video.operations = ['image_to_video'];
  f.model.capability_config_json = JSON.stringify(f.config);
  const video = JSON.parse(auditCapabilities(f.catalog, f.snapshot).changes[0].after).video;
  assert.deepEqual(video.operations, ['image_to_video', 'reference_to_video']);
  assert.equal(video.references.maxVideos, 0);
});

test('capability SQL updates neither prices nor provider protocols', () => {
  const f = fixture();
  const sql = capabilityAuditSQL(f.snapshot, auditCapabilities(f.catalog, f.snapshot), true);
  assert.match(sql, /capability_version=m.capability_version\+1/);
  assert.doesNotMatch(sql, /SET[^;]*(unit_price|price_version|protocol=)/s);
});

test('required audio workflows retain their restrictive operations until joint-input validation exists', () => {
  const f = fixture('minimax-h3-e', '1-9 张参考图和 1 段音频 1-15 秒');
  Object.assign(f.config.video.references, { minImages: 1, maxImages: 9, maxAudios: 1 });
  f.config.video.operations = ['audio_to_video'];
  f.model.capability_config_json = JSON.stringify(f.config);
  const report = auditCapabilities(f.catalog, f.snapshot);
  assert.equal(report.changes.length, 0);
  assert.match(report.models[0].pending.join(' '), /必需音频/);
});

test('PostgreSQL capability changes roll back, preserve prices, commit idempotently and reject stale snapshots', {
  skip: !process.env.QT_CAPABILITY_TEST_BACKUP,
}, () => {
  const directory = process.env.QT_CAPABILITY_TEST_BACKUP;
  const snapshot = JSON.parse(readFileSync(join(directory, 'before.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(directory, 'upstream.json'), 'utf8'));
  const protocolCatalog = JSON.parse(readFileSync(join(directory, 'protocol-catalog.json'), 'utf8'));
  const report = auditCapabilities(catalog, snapshot, protocolCatalog);
  assert.ok(report.changes.length > 0);
  const encoded = Buffer.from(JSON.stringify(snapshot)).toString('base64');
  const seed = `CREATE TEMP TABLE model_channels (LIKE public.model_channels INCLUDING DEFAULTS);
CREATE TEMP TABLE channel_models (LIKE public.channel_models INCLUDING DEFAULTS);
CREATE TEMP TABLE channel_model_price_tiers (LIKE public.channel_model_price_tiers INCLUDING DEFAULTS);
CREATE TEMP TABLE id_sequences (LIKE public.id_sequences INCLUDING DEFAULTS);
CREATE TEMP TABLE qt_fixture (data jsonb);
INSERT INTO qt_fixture VALUES (convert_from(decode('${encoded}', 'base64'),'UTF8')::jsonb);
INSERT INTO model_channels (id,name,scope,enabled,updated_at,base_url,models_json)
SELECT c.id,c.name,c.scope,c.enabled,c.updated_at,c.base_url,c.models_json FROM
jsonb_to_record((SELECT data->'channel' FROM qt_fixture)) AS c(id text,name text,scope text,enabled boolean,updated_at timestamptz,base_url text,models_json text);
INSERT INTO channel_models SELECT * FROM jsonb_populate_recordset(NULL::channel_models,(SELECT data->'models' FROM qt_fixture));
INSERT INTO channel_model_price_tiers SELECT * FROM jsonb_populate_recordset(NULL::channel_model_price_tiers,(SELECT data->'tiers' FROM qt_fixture));
INSERT INTO id_sequences SELECT * FROM jsonb_populate_recordset(NULL::id_sequences,(SELECT data->'sequences' FROM qt_fixture));
`;
  const sql = command => spawnSync('docker', ['compose', '-f', 'docker-compose.deploy.yml', 'exec', '-T', 'postgres',
    'sh', '-c', 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
  { input: seed + command, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const dryRun = sql(capabilityAuditSQL(snapshot, report, false) + SNAPSHOT_SQL + ';');
  assert.equal(dryRun.status, 0, 'Capability rollback should succeed');
  assert.deepEqual(JSON.parse(dryRun.stdout), snapshot);
  const applied = sql(capabilityAuditSQL(snapshot, report, true) + SNAPSHOT_SQL + ';');
  assert.equal(applied.status, 0, 'Capability commit should succeed');
  const after = JSON.parse(applied.stdout);
  assert.deepEqual(after.tiers, snapshot.tiers);
  assert.deepEqual(after.sequences, snapshot.sequences);
  assert.deepEqual(after.channel, snapshot.channel);
  for (const old of snapshot.models) {
    const current = after.models.find(row => row.id === old.id);
    const change = report.changes.find(row => row.id === old.id);
    assert.equal(current.capability_version, old.capability_version + (change ? 1 : 0));
    for (const key of Object.keys(old)) {
      if (['capability_config_json', 'capability_version', 'updated_at'].includes(key)) continue;
      assert.deepEqual(current[key], old[key], `${old.model_key}: ${key} must remain unchanged`);
    }
  }
  assert.equal(auditCapabilities(catalog, after, protocolCatalog).changes.length, 0);
  const conflict = sql(`UPDATE channel_models SET description=description||' changed';` + capabilityAuditSQL(snapshot, report, true));
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /QT capability snapshot changed/);
});
