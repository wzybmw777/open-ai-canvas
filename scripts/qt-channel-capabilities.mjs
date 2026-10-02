import { isDeepStrictEqual } from 'node:util';

// Only reviewed, explicit QT statements can change a capability contract.
// Missing limits and conflicting public sources remain review findings.
export const QT_VIDEO_RULES = {
  'minimax-h3-a': { evidence: ['不接收参考素材', '1-12 秒'], images: 0, videos: 0, audios: 0, seconds: [1, 12], forbiddenResolutions: ['1080p'] },
  'minimax-h3-b': { evidence: ['1-9 张参考图', '1-15 秒'], minImages: 1, images: 9, videos: 0, audios: 0, seconds: [1, 15], forbiddenResolutions: ['1080p'] },
  'minimax-h3-c': { evidence: ['首帧和尾帧各 1 张', '1-15 秒'], minImages: 2, images: 2, videos: 0, audios: 0, seconds: [1, 15], forbiddenResolutions: ['1080p'],
    pending: ['能力配置只能表达两张图片下限，不能保证它们分别绑定首帧、尾帧；须另验收引用角色。'] },
  'minimax-h3-d': { evidence: ['1 张图片和 1 段音频', '1-15 秒'], minImages: 1, images: 1, videos: 0, audios: 1, seconds: [1, 15] },
  'minimax-h3-e': { evidence: ['1-9 张参考图和 1 段音频', '1-15 秒'], minImages: 1, images: 9, videos: 0, audios: 1, seconds: [1, 15] },
  'wan3.0-video': { evidence: ['10-5-5 全能参考'], images: 10, videos: 5, audios: 5,
    pending: ['QT 未写输出时长范围；万有引力结构化目录为 2–30 秒，本地为 1–15 秒，需渠道确认。'] },
  'wan3.0-video-prime': { evidence: ['10-5-5 全能参考'], images: 10, videos: 5, audios: 5,
    pending: ['QT 未写输出时长范围；万有引力结构化目录为 2–30 秒，本地为 1–15 秒，需渠道确认。'] },
  'wan3.0-image': { evidence: ['至少 1 张参考图', '可参考音频', '不支持参考视频'], minImages: 1, videos: 0 },
  'wan3.0-image-prime': { evidence: ['至少 1 张参考图', '可参考音频', '不支持参考视频'], minImages: 1, videos: 0 },
  '官方h3-1080p': { evidence: ['5-15 秒', '最多 9 图 / 3 音频', '不支持参考视频'], images: 9, videos: 0, audios: 3, seconds: [5, 15], resolutions: ['1080p'] },
  '官方h3-2k': { evidence: ['5-15 秒', '最多 9 图 / 3 音频', '不支持参考视频'], images: 9, videos: 0, audios: 3, seconds: [5, 15], resolutions: ['2k'] },
  '官方h3-720p': { evidence: ['5-15 秒', '最多 9 图 / 3 音频', '不支持参考视频'], images: 9, videos: 0, audios: 3, seconds: [5, 15], resolutions: ['720p'] },
  'wan30-720p': { evidence: ['4–30 秒', '带参考视频时 4–15 秒', '10 图、5 视频、5 音频'], images: 10, videos: 5, audios: 5, seconds: [4, 30], maxWithReferenceVideo: 15, resolutions: ['720p'] },
  'sd2.0-fast': { evidence: ['时长5-15秒', '9图3音3视频'], images: 9, videos: 3, audios: 3, seconds: [5, 15], resolutions: ['720p'] },
  'seedance2.0-933': { evidence: ['5-15秒', '图9/视频3/音频3'], images: 9, videos: 3, audios: 3, seconds: [5, 15], resolutions: ['720p'] },
  'seedance2.0-fast': { evidence: ['9-0-0', '固定 15 秒'], images: 9, videos: 0, audios: 0, seconds: [15], resolutions: ['720p'],
    pending: ['万有引力结构化目录写 9 图 / 3 视频 / 3 音频，与 QT 的 9-0-0 冲突；暂按 QT 禁用音视频参考。'] },
  'sd-2.5-720p-ultra': { evidence: ['30-0-10', '5秒-30秒'], images: 30, videos: 0, audios: 10, seconds: [5, 30], resolutions: ['720p'] },
  'sd-2.5-480p-plus': { evidence: ['4-30 秒', '图30/视频10/音频10'], images: 30, videos: 10, audios: 10, seconds: [4, 30], resolutions: ['480p'] },
  'sd-2.5-720p-plus': { evidence: ['4-30 秒', '图30/视频10/音频10'], images: 30, videos: 10, audios: 10, seconds: [4, 30], resolutions: ['720p'] },
  'sd-2.5-480p-pro': { evidence: ['5-30秒', '30参考图 0视频 10参考音频'], images: 30, videos: 0, audios: 10, seconds: [5, 30], resolutions: ['480p'],
    pending: ['万有引力结构化目录最小时长为 4 秒，QT 介绍为 5 秒；暂按 QT 保留 5 秒。'] },
  'sd-2.5-720p-pro': { evidence: ['30参考图 0视频 10参考音频'], images: 30, videos: 0, audios: 10, resolutions: ['720p'],
    pending: ['QT 未写时长；万有引力结构化目录为 4–30 秒，本地为 1–15 秒，需渠道确认。'] },
  'sd-mini': { evidence: ['720p 4–12 秒', '9张参考图、0参考视频、3段参考音频'], images: 9, videos: 0, audios: 3, seconds: [4, 12], resolutions: ['720p'],
    pending: ['万有引力结构化目录为 480p/720p、4–15 秒，与 QT 介绍冲突。'] },
  'sd2.0-720p': { evidence: ['9张参考图 3个参考视频 3个参考音频'], images: 9, videos: 3, audios: 3, resolutions: ['720p'],
    pending: ['QT 未写时长；万有引力结构化目录为 4–30 秒，本地为 1–15 秒，需渠道确认。'] },
  'seedance-2.5s': { evidence: ['固定 30 秒', '参考图最多 30 张'], images: 30, seconds: [30],
    pending: ['QT 为固定 30 秒、仅明确图片参考；万有引力结构化目录为 1–30 秒并支持音视频，需渠道确认。'] },
  'seedance2.5-a': { evidence: ['4-30 秒', '16:9、9:16', '30 张参考图片和 10 段参考音频', '不支持参考视频'], images: 30, videos: 0, audios: 10, seconds: [4, 30], resolutions: ['720p'], ratios: ['16:9', '9:16'] },
  'sd-2.5-1080p-max': { evidence: ['30-10-10', '5-30秒'], images: 30, videos: 10, audios: 10, seconds: [5, 30],
    pending: ['QT 型号与报价为 1080p，但万有引力结构化目录写 480p/720p；保留 QT 报价对应分辨率。'] },
  'dola-720p': { evidence: ['720p/30秒', '10 张参考图', '16:9, 9:16'], images: 10, seconds: [30], resolutions: ['720p'], ratios: ['16:9', '9:16'],
    pending: ['万有引力结构化目录为 480p/720p、1–30 秒并标记音视频支持，与 QT 介绍不一致。'] },
  'grok-imagine-video-1.5-fast': { evidence: ['4–15 秒', '7 张参考图', '不支持参考视频或音频'], images: 7, videos: 0, audios: 0, seconds: [4, 15] },
  'grok-imagine-video-1.5（按次）': { evidence: ['4–15 秒', '7 张参考图', '不支持参考视频或音频'], images: 7, videos: 0, audios: 0, seconds: [4, 15] },
  'sd-2.5': { evidence: ['固定 30 秒 / 720P', '不支持音视频参考'], videos: 0, audios: 0, seconds: [30], resolutions: ['720p'],
    pending: ['万有引力结构化目录写最多 10 图 / 5 视频，与 QT 禁止音视频参考冲突；QT 未说明图片上限。'] },
  'seedance2.5-480': { evidence: ['30图+10音频', '4–25秒'], images: 30, audios: 10, seconds: [4, 25], resolutions: ['480p'] },
  'seedance2.5-480s': { evidence: ['30图+10音频', '4–30秒'], images: 30, audios: 10, seconds: [4, 30], resolutions: ['480p'],
    pending: ['万有引力结构化目录最大 25 秒，与 QT 的 30 秒冲突。'] },
  'seedance2.5-720': { evidence: ['30图+10音频', '4–25秒'], images: 30, audios: 10, seconds: [4, 25], resolutions: ['720p'] },
  'seedance2.5-720s': { evidence: ['30图+10音频', '4–28秒'], images: 30, audios: 10, seconds: [4, 28], resolutions: ['720p'],
    pending: ['万有引力结构化目录最大 25 秒，与 QT 的 28 秒冲突。'] },
};

const MEDIA_KEYS = { images: 'maxImages', videos: 'maxVideos', audios: 'maxAudios' };

export function auditCapabilities(catalog, snapshot, protocolCatalog) {
  const groups = catalog?.data?.groups?.filter(group => group.id === 83 && group.name === '万有引力图片视频组');
  if (catalog?.code !== 0 || groups?.length !== 1 || !Array.isArray(groups[0].models)) throw new Error('Invalid QT capability source');
  const upstream = new Map(groups[0].models.map(model => [model.name, model]));
  if (upstream.size !== groups[0].models.length) throw new Error('Duplicate QT capability source');
  const protocols = new Map((protocolCatalog?.data?.models || []).map(model => [model.name, model]));
  const changes = [], models = [];
  for (const model of snapshot.models) {
    const source = upstream.get(model.model_key);
    const current = JSON.parse(model.capability_config_json);
    if (current.version !== 1 || !current[model.capability]) throw new Error(`${model.model_key}: invalid capability config`);
    const next = structuredClone(current), differences = [], pending = [];
    const item = { model: model.model_key, description: source?.description || '', capability: model.capability,
      protocol: model.protocol, differences, pending };
    if (!source) { pending.push('QT 当前目录中缺少该型号。'); models.push(item); continue; }
    if (model.capability !== 'video') {
      pending.push('QT 简介未完整列出参考图、蒙版、透明背景、输出格式等能力；不能将简介未提及视为不支持。');
      models.push(item); continue;
    }
    const video = next.video, rule = QT_VIDEO_RULES[model.model_key];
    if (!video.references || !video.duration || !Array.isArray(video.operations)) {
      pending.push('视频能力合同不完整，须先通过应用能力校验。');
      models.push(item); continue;
    }
    const set = (field, value, target = video) => {
      if (!isDeepStrictEqual(target[field], value)) {
        differences.push({ field: target === video.references ? `references.${field}` : field, before: target[field], after: value });
        target[field] = value;
      }
    };
    if (rule) {
      if (!rule.evidence.every(text => source.description?.includes(text))) {
        pending.push('QT 介绍已变化，已审核规则失效；本次不修改能力。');
        models.push(item); continue;
      }
      for (const [name, field] of Object.entries(MEDIA_KEYS)) if (rule[name] !== undefined) set(field, rule[name], video.references);
      if (rule.minImages !== undefined) set('minImages', rule.minImages, video.references);
      if (rule.seconds) {
        const [min, max] = rule.seconds;
        const defaultSeconds = Math.max(min, Math.min(max || min, video.duration.default));
        const duration = max ? { selection: 'range', min, max, step: 1, default: defaultSeconds }
          : { selection: 'enum', values: [min], default: min };
        if (rule.maxWithReferenceVideo) duration.maxWithReferenceVideo = rule.maxWithReferenceVideo;
        else if (video.duration.maxWithReferenceVideo) duration.maxWithReferenceVideo = video.duration.maxWithReferenceVideo;
        set('duration', duration);
      }
      for (const field of ['resolutions', 'ratios']) if (rule[field]) {
        // Order has no semantic meaning; retain the existing display order.
        if (JSON.stringify([...video[field]].sort()) !== JSON.stringify([...rule[field]].sort())) set(field, rule[field]);
        const defaultField = field === 'resolutions' ? 'defaultResolution' : 'defaultRatio';
        if (!video[field].includes(video[defaultField])) set(defaultField, video[field][0]);
      }
      if (rule.forbiddenResolutions?.some(value => video.resolutions.includes(value))) {
        set('resolutions', video.resolutions.filter(value => !rule.forbiddenResolutions.includes(value)));
        if (!video.resolutions.includes(video.defaultResolution)) set('defaultResolution', video.resolutions[0]);
      }
      pending.push(...(rule.pending || []));
    } else {
      pending.push('QT 简介缺少完整可量化合同；保留未核实的时长、数量与规格。');
    }
    const references = video.references;
    const operations = [...video.operations];
    // The real canvas infers reference_to_video for >2 images, even without video input.
    const requiresAudio = /minimax-h3-[de]$/.test(model.model_key);
    if (!requiresAudio && (references.maxImages > 2 || references.maxVideos > 0)) {
      if (!operations.includes('reference_to_video')) operations.push('reference_to_video');
    }
    if (references.maxAudios > 0 && references.minImages === 0 && !operations.includes('audio_to_video')) operations.push('audio_to_video');
    if (!requiresAudio && references.maxImages > 0 && !operations.includes('image_to_video')) operations.push('image_to_video');
    set('operations', operations);
    if (/wan3\.0-image/.test(model.model_key)) pending.push('QT 明确支持参考音频，但未写数量上限；本地仍为 0，需要渠道确认上限及请求格式。');
    if (/minimax-h3-[de]/.test(model.model_key)) pending.push('必须同时有图片和音频；当前合同仅能强制图片下限，未表达必需音频。');
    if (model.model_key.startsWith('官方h3-')) pending.push('上游要求图片或音频至少一种；本地 minImages=1 会拒绝纯音频，当前合同不能表达二选一输入下限。');
    const protocol = protocols.get(model.model_key);
    if (protocol?.protocol_id === 'async-video-generations' && model.protocol === 'lxmone-seedance-videos') pending.push('结构化文档要求 /v1/videos/generations，本地协议走 /v1/videos，需要独立核对渠道协议。');
    if (['seedance2.5-480', 'seedance2.5-480s', 'seedance2.5-720', 'seedance2.5-720s'].includes(model.model_key)) pending.push('当前文档示例使用 assets/category、duration、size；本地通用 Seedance 协议使用 reference_*、duration_seconds、resolution，需独立修正协议。');
    if (model.model_key.startsWith('grok-imagine-video-')) pending.push('当前文档示例使用 seconds、size，本地 Grok 协议使用 duration、resolution，需独立核对协议。');
    if (model.model_key === 'wan30-720p') pending.push('当前文档示例使用字符串 reference_images、resolution，本地 Wan 协议使用对象 reference_images、size，需确认渠道是否接受两种写法。');
    if (differences.length) changes.push({ id: model.id, modelKey: model.model_key,
      before: model.capability_config_json, after: JSON.stringify(next), capabilityVersion: model.capability_version });
    models.push(item);
  }
  return { checkedModels: models.length, changedModels: changes.length,
    pendingModels: models.filter(model => model.pending.length).length, changes, models };
}

export function capabilityAuditSQL(snapshot, report, apply) {
  const encoded = Buffer.from(JSON.stringify({ snapshot, changes: report.changes })).toString('base64');
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE model_channels, channel_models IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE qt_capability_payload (data jsonb) ON COMMIT DROP;
INSERT INTO qt_capability_payload VALUES (convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb);
DO $$ BEGIN
  IF (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) FROM channel_models m
      WHERE m.channel_id='CHANNEL_000014' AND m.deleted_at IS NULL)
     IS DISTINCT FROM (SELECT data->'snapshot'->'models' FROM qt_capability_payload) THEN
    RAISE EXCEPTION 'QT capability snapshot changed; retry';
  END IF;
END $$;
UPDATE channel_models m SET capability_config_json=p.after, capability_version=m.capability_version+1, updated_at=now()
FROM jsonb_to_recordset((SELECT data->'changes' FROM qt_capability_payload)) AS p(id text, after text)
WHERE m.id=p.id AND m.channel_id='CHANNEL_000014' AND m.deleted_at IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset((SELECT data->'changes' FROM qt_capability_payload))
      AS p(id text, after text, "capabilityVersion" integer)
      LEFT JOIN channel_models m ON m.id=p.id
      WHERE m.id IS NULL OR m.capability_config_json<>p.after OR m.capability_version<>p."capabilityVersion"+1)
    THEN RAISE EXCEPTION 'QT capability verification failed'; END IF;
END $$;
${apply ? 'COMMIT' : 'ROLLBACK'};
`;
}
