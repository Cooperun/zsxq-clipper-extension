import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuality, infoDensity, computeFreshness, computeTotalScore } from '../lib/scorer.mjs';

test('infoDensity: 字数+代码块+链接叠加', () => {
  assert.equal(infoDensity({ text: 'a'.repeat(300), codeBlocks: 2, links: 3 }),
    3 + 2 * 5 + 3 * 3); // 字数300/100=3, 代码2*5, 链接3*3 → 20
});

test('computeQuality: 精华帖加分', () => {
  const base = { likes: 5, comments: 2, digest: false, text: 'x'.repeat(200), codeBlocks: 0, links: 0 };
  const digest = { ...base, digest: true };
  assert.ok(computeQuality(digest) > computeQuality(base) + 25);
});

test('computeQuality: 评论权重高于点赞', () => {
  const a = { likes: 10, comments: 0, digest: false, text: 'x'.repeat(200), codeBlocks: 0, links: 0 };
  const b = { likes: 0, comments: 5, digest: false, text: 'x'.repeat(200), codeBlocks: 0, links: 0 };
  assert.ok(computeQuality(b) > computeQuality(a)); // 5评论×3=15 > 10赞×1=10
});

test('computeFreshness: 今天=1,15天≈0.5,30天=0,>30天=0', () => {
  const now = new Date('2026-07-06T12:00:00+0800').getTime();
  assert.equal(computeFreshness('2026-07-06T12:00:00+0800', now), 1);
  assert.ok(Math.abs(computeFreshness('2026-06-21T12:00:00+0800', now) - 0.5) < 0.05);
  assert.equal(computeFreshness('2026-06-06T12:00:00+0800', now), 0);
  assert.equal(computeFreshness('2025-01-01T00:00:00+0800', now), 0);
  assert.equal(computeFreshness('', now), 0);
});

test('computeTotalScore: 三维度加权 → 1-10', () => {
  // freshness=1, novelty=1, utility=10 → (0.2+0.3+0.5)*10=10
  assert.equal(computeTotalScore({ freshness: 1, novelty: 1, utility: 10 }), 10);
  // freshness=0, novelty=0, utility=0 → 0 → clamp 1
  assert.equal(computeTotalScore({ freshness: 0, novelty: 0, utility: 0 }), 1);
  // freshness=0.5, novelty=0.5, utility=5 → (0.1+0.15+0.25)*10=5
  assert.equal(computeTotalScore({ freshness: 0.5, novelty: 0.5, utility: 5 }), 5);
});
