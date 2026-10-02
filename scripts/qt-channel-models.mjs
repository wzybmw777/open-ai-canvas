// Explicit protocol/capability profiles for the currently priced QT additions.
// Unknown model names require a profile instead of inheriting an unrelated protocol.
const PROFILES = {
  'dola-720p': { template: 'seedance-2.5s', protocol: 'lxmone-sd-videos', resolution: '720p', seconds: [30], images: 10, audios: 0, ratios: ['16:9', '9:16'] },
  'grok-imagine-image-2.0': { template: 'gpt-image-2', protocol: 'grok-image', image: true },
  'grok-imagine-video-1.5-fast': { template: 'seedance2.5-a', protocol: 'lxmone-grok-videos', resolution: '720p', seconds: [4, 15], images: 7, audios: 0 },
  'grok-imagine-video-1.5（按次）': { template: 'seedance2.5-a', protocol: 'lxmone-grok-videos', resolution: '720p', seconds: [4, 15], images: 7, audios: 0 },
  'sd-2.5': { template: 'seedance-2.5s', protocol: 'lxmone-sd-videos', resolution: '720p', seconds: [30], images: 30, audios: 0 },
  'seedance2.0-720p': { template: 'sd2.0-720p', protocol: 'lxmone-seedance-videos', resolution: '720p', seconds: [5, 15], images: 9, audios: 3, videos: 3 },
  'seedance2.5-480': { template: 'seedance2.5-a', resolution: '480p', seconds: [4, 25], images: 30, audios: 10 },
  'seedance2.5-480s': { template: 'seedance2.5-a', resolution: '480p', seconds: [4, 30], images: 30, audios: 10 },
  'seedance2.5-720': { template: 'seedance2.5-a', resolution: '720p', seconds: [4, 25], images: 30, audios: 10 },
  'seedance2.5-720s': { template: 'seedance2.5-a', resolution: '720p', seconds: [4, 28], images: 30, audios: 10 },
  '官方h3-1080p': { template: 'minimax-h3-b', protocol: 'lxmone-h3-max-videos', resolution: '1080p', seconds: [5, 15], images: 9, audios: 3, minImages: 1 },
  '官方h3-2k': { template: 'minimax-h3-b', protocol: 'lxmone-h3-max-videos', resolution: '2k', seconds: [5, 15], images: 9, audios: 3, minImages: 1 },
  '官方h3-720p': { template: 'minimax-h3-b', protocol: 'lxmone-h3-max-videos', resolution: '720p', seconds: [5, 15], images: 9, audios: 3, minImages: 1 },
};

export function prepareModels(upstreamModels, snapshot, authorized) {
  const models = structuredClone(snapshot.models);
  const tiers = structuredClone(snapshot.tiers);
  const newModels = [], newTiers = [], warnings = [];
  const sequences = new Map((snapshot.sequences || []).map(row => [row.name, row.value]));
  const originalSequences = new Map(sequences);
  const now = new Date().toISOString();
  const nextID = prefix => {
    const key = `id:${prefix}`;
    const value = sequences.get(key);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Missing or invalid ${prefix} ID sequence`);
    sequences.set(key, value + 1);
    return `${prefix}_${String(value + 1).padStart(6, '0')}`;
  };
  let sortOrder = Math.max(...models.map(model => model.sort_order || 0));
  for (const [key, upstream] of upstreamModels) {
    if (models.some(model => model.model_key === key) || !authorized.has(key)) continue;
    const profile = PROFILES[key];
    if (!profile) { warnings.push(`${key}: missing protocol/capability profile, not imported`); continue; }
    const template = models.find(model => model.model_key === profile.template);
    if (!template) throw new Error(`${key}: capability template is missing`);
    const config = JSON.parse(template.capability_config_json);
    if (profile.image) {
      const image = config.image;
      image.size = { parameter: 'aspect_ratio', values: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'], default: '1:1', allowCustom: false };
      image.quality = { supported: true, values: ['1k'], default: '1k' };
      image.references.maxImages = 1;
      image.references.maskSupported = false;
      image.transparentBackground = { supported: false, default: false };
      image.outputFormat = { supported: false };
      image.maxOutputs = 1;
    } else {
      const video = config.video;
      video.resolutions = [profile.resolution];
      video.defaultResolution = profile.resolution;
      video.duration = profile.seconds.length === 1
        ? { selection: 'enum', values: profile.seconds, default: profile.seconds[0] }
        : { selection: 'range', min: profile.seconds[0], max: profile.seconds[1], step: 1, default: profile.seconds[0] };
      if (profile.ratios) video.ratios = profile.ratios;
      video.operations = ['text_to_video', 'image_to_video'];
      if (profile.images > 2 || profile.videos) video.operations.push('reference_to_video');
      if (profile.audios) video.operations.push('audio_to_video');
      video.defaultOperation = profile.minImages ? 'image_to_video' : 'text_to_video';
      if (profile.minImages) video.operations = video.operations.filter(operation => operation !== 'text_to_video');
      Object.assign(video.references, { minImages: profile.minImages || 0, maxImages: profile.images,
        maxAudios: profile.audios || 0, maxVideos: profile.videos || 0 });
    }
    const model = { ...structuredClone(template), id: nextID('MODEL'), model_key: key, provider_model_key: key,
      display_name: key, description: '', sort_order: ++sortOrder, protocol: profile.protocol || template.protocol,
      enabled: false, price_configured: false, unit_price_microcredits: 0,
      input_token_price_microcredits: 0, output_token_price_microcredits: 0, cached_token_price_microcredits: 0,
      price_version: 1, capability_version: 1, capability_config_json: JSON.stringify(config),
      created_at: now, updated_at: now, deleted_at: null };
    models.push(model);
    newModels.push(model);
  }
  for (const model of models) {
    const upstream = upstreamModels.get(model.model_key);
    if (!upstream || !authorized.has(model.provider_model_key) || tiers.some(tier => tier.channel_model_id === model.id && tier.enabled)) continue;
    if (tiers.some(tier => tier.channel_model_id === model.id)) {
      throw new Error(`${model.model_key}: disabled existing price tiers require review`);
    }
    const pricing = upstream.pricing;
    const billing = { video: 'per_second', image: 'fixed_request', per_request: 'fixed_request' }[pricing?.billing_mode];
    if (!billing || !Array.isArray(pricing.intervals) || upstream.time_pricing) {
      throw new Error(`${model.model_key}: cannot configure missing price tiers`);
    }
    const template = tiers.find(tier => tier.billing_mode !== 'token');
    if (!template) throw new Error('No configured price tier template');
    const entries = pricing.intervals.length > 0 ? pricing.intervals : [{ tier_label: null }];
    for (const entry of entries) {
      const selector = {};
      if (entry.tier_label !== null) {
        if (typeof entry.tier_label !== 'string' || !entry.tier_label) throw new Error(`${model.model_key}: missing quality label`);
        selector[model.capability === 'image' ? 'quality' : 'vquality'] = entry.tier_label.toLowerCase();
      }
      const tier = { ...structuredClone(template), id: nextID('PTIER'), channel_model_id: model.id,
        provider_model_key: model.provider_model_key, selector_json: JSON.stringify(selector), selector_key: JSON.stringify(selector),
        resolution: selector.vquality || '*', video_seconds: 0, billing_mode: billing,
        unit_price_microcredits: 0, cost_unit_price_microcredits: 0,
        input_token_price_microcredits: 0, output_token_price_microcredits: 0, cached_token_price_microcredits: 0,
        cost_input_token_price_microcredits: 0, cost_output_token_price_microcredits: 0, cost_cached_token_price_microcredits: 0,
        enabled: true, price_configured: true, cost_configured: true, price_version: 1,
        created_at: now, updated_at: now, deleted_at: null };
      tiers.push(tier);
      newTiers.push(tier);
    }
  }
  return { models, tiers, newModels, newTiers, warnings,
    sequences: [...sequences].filter(([name, value]) => value !== originalSequences.get(name)).map(([name, value]) => ({ name, value })) };
}
