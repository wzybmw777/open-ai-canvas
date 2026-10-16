import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetup } from './sync-qtrader-h3.mjs';

function catalog() {
  return { code: 0, data: { groups: [{ id: 100, name: 'sparkcine-h3组', rate_multiplier: 1,
    peak_rate_enabled: false, models: [{ name: 'h3-video', description: 'H3 视频',
      pricing: { billing_mode: 'video', intervals: ['480p', '720p', '768p', '960p', '1080p'].map((tier_label, i) => ({
        tier_label, min_tokens: 0, max_tokens: null, per_request_price: [0.015, 0.015, 0.015, 0.12, 0.16][i],
      })) } }, { name: 'img-2-5s' }] }] } };
}

test('only H3 is imported; durations, ratios and prices match each exposed option', () => {
  const plan = buildSetup(catalog());
  assert.deepEqual(plan.models.map(m => m.providerModelKey), ['h3-video', 'h3-video']);
  assert.equal(plan.sync.importNew, false);
  assert.equal(plan.sync.groupId, 100);
  assert.equal(plan.models[0].capabilityConfig.video.duration.max, 30);
  assert.equal(plan.models[1].capabilityConfig.video.duration.max, 15);
  assert.match(plan.models[0].description, /4–30 秒/);
  assert.doesNotMatch(plan.models[0].description, /15|960p|1080p/);
  assert.match(plan.models[1].description, /4–15 秒/);
  assert.doesNotMatch(plan.models[1].description, /30|480p|720p|768p/);
  assert.deepEqual(plan.models[0].capabilityConfig.video.ratios, ['16:9', '9:16']);
  assert.equal(plan.models[0].capabilityConfig.video.references.maxImages, 9);
  assert.ok(plan.models.every(m => m.tags.length <= 5 && m.tags.every(t => [...t.text].length <= 12 && ['purple', 'blue', 'green', 'gold', 'orange', 'pink'].includes(t.color))));
  assert.deepEqual(plan.models.flatMap(m => m.priceTiers.map(t => t.unitPriceMicrocredits)), [18750, 18750, 18750, 150000, 200000]);
});

test('missing, duplicated, dynamic and invalid costs stop setup', () => {
  for (const mutate of [
    c => c.data.groups.push(structuredClone(c.data.groups[0])),
    c => c.data.groups[0].rate_multiplier = 2,
    c => c.data.groups[0].video_rate_independent = true,
    c => c.data.groups[0].models[0].pricing.billing_mode = 'per_request',
    c => c.data.groups[0].models[0].pricing.intervals.pop(),
    c => c.data.groups[0].models[0].pricing.intervals[0].tier_label = '720p',
    c => c.data.groups[0].models[0].pricing.intervals[0].per_request_price = 0,
    c => c.data.groups[0].models[0].pricing.intervals[0].per_request_price = 0.0000001,
  ]) {
    const fixture = catalog(); mutate(fixture); assert.throws(() => buildSetup(fixture));
  }
});
