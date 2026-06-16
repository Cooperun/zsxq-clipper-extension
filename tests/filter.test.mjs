import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coarseFilter, DEFAULT_THRESHOLD } from '../lib/filter.mjs';

const mk = (over) => ({ likes: 0, comments: 0, digest: false, text: '', codeBlocks: 0, links: 0, ...over });

test('低质帖被过滤:无赞无评论非精华且字数少', () => {
  assert.equal(coarseFilter([mk({ text: '短' })]).length, 0);
});

test('精华帖无条件保留', () => {
  assert.equal(coarseFilter([mk({ digest: true, text: '短' })]).length, 1);
});

test('高赞帖保留', () => {
  assert.equal(coarseFilter([mk({ likes: 10 })]).length, 1);
});

test('长帖保留(信息量足够)', () => {
  assert.equal(coarseFilter([mk({ text: 'x'.repeat(150) })]).length, 1);
});
