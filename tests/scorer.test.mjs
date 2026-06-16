import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuality, infoDensity } from '../lib/scorer.mjs';

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
