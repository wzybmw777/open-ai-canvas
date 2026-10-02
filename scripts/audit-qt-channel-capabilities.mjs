import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNAPSHOT_SQL, SOURCE_URL } from './sync-qt-channel.mjs';
import { auditCapabilities, capabilityAuditSQL } from './qt-channel-capabilities.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function database(sql) {
  const result = spawnSync('docker', ['compose', '--env-file', '.env', '-f', 'docker-compose.deploy.yml',
    'exec', '-T', 'postgres', 'sh', '-c', 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
  { cwd: ROOT, input: sql, encoding: 'utf8', timeout: 40000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    const known = ['QT capability snapshot changed; retry', 'QT capability verification failed'].find(message => result.stderr?.includes(message));
    throw new Error(known || 'Capability audit database command failed');
  }
  return result.stdout;
}

async function publicJSON(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Public capability source returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['--apply', '--dry-run'].includes(args[0]))) throw new Error('Usage: node scripts/audit-qt-channel-capabilities.mjs [--dry-run|--apply]');
  process.umask(0o077);
  const apply = args[0] === '--apply';
  const [catalog, protocolCatalog] = await Promise.all([publicJSON(SOURCE_URL), publicJSON('https://lxmone.xyz/api/v1/docs/model-catalog')]);
  if (protocolCatalog.code !== 0 || !Array.isArray(protocolCatalog.data?.models)) throw new Error('Invalid protocol capability source');
  const snapshot = JSON.parse(database(SNAPSHOT_SQL + ';'));
  if (snapshot.channel.id !== 'CHANNEL_000014' || snapshot.channel.name !== 'QT中转-2' || snapshot.channel.scope !== 'system') throw new Error('Wrong capability audit channel');
  const report = auditCapabilities(catalog, snapshot, protocolCatalog);
  const directory = join(ROOT, '.local', 'backups', 'qt-capability-audit', new Date().toISOString().replaceAll(':', '-') + (apply ? '--apply' : '--dry-run'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const save = (filename, data) => writeFileSync(join(directory, filename), JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  save('before.json', snapshot);
  save('upstream.json', catalog);
  save('protocol-catalog.json', protocolCatalog);
  save('report.json', report);
  const lines = ['# QT 本地能力校验', '', `核对 ${report.checkedModels} 个型号；可修正 ${report.changedModels} 个；${report.pendingModels} 个存在待核实字段或协议。`, '',
    '依据：QT 当前介绍；万有引力结构化目录及公开请求示例仅作交叉核对。差异清单只包含能够从明确介绍或实际画布输入判定规则回溯的字段。', ''];
  for (const model of report.models) {
    lines.push(`## ${model.model}`, '', model.description, '', `协议：${model.protocol}`, '');
    for (const difference of model.differences) lines.push(`- 修正 ${difference.field}：${JSON.stringify(difference.before)} → ${JSON.stringify(difference.after)}`);
    for (const pending of model.pending) lines.push(`- 待核实：${pending}`);
    if (!model.differences.length && !model.pending.length) lines.push('- 已审核字段与 QT 介绍一致；未说明的字段不代表已验收。');
    lines.push('');
  }
  writeFileSync(join(directory, 'report.md'), lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  const sql = capabilityAuditSQL(snapshot, report, apply);
  writeFileSync(join(directory, 'transaction.sql'), sql, { mode: 0o600, flag: 'wx' });
  database(sql);
  const after = JSON.parse(database(SNAPSHOT_SQL + ';'));
  // A transaction validates every written row; this reread also records the exact persisted result.
  save('after.json', after);
  save('result.json', { status: apply ? 'committed' : 'rolled_back', changedModels: report.changedModels });
  if (apply && report.changedModels) {
    const refreshed = spawnSync('docker', ['compose', '--env-file', '.env', '-f', 'docker-compose.deploy.yml',
      'exec', '-T', 'redis', 'redis-cli', 'INCR', 'canvas:logical-model-route-catalog:version'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
    if (refreshed.status !== 0) throw new Error('Capabilities committed but route catalog refresh failed');
  }
  console.log(JSON.stringify({ status: apply ? 'updated' : 'dry-run', checkedModels: report.checkedModels,
    changedModels: report.changedModels, pendingModels: report.pendingModels, directory }));
}

main().catch(error => { console.error(`QT capability audit failed: ${error.message}`); process.exitCode = 1; });
