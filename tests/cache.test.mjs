import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCache, keyFor } from '../lib/cache.mjs';

test('keyFor: 同 topic+内容同 key', () => {
  assert.equal(keyFor({ topic_id: '1', text: 'abc' }), keyFor({ topic_id: '1', text: 'abc' }));
  assert.notEqual(keyFor({ topic_id: '1', text: 'abc' }), keyFor({ topic_id: '1', text: 'abcd' }));
});

test('makeCache: get 命中/未命中', async () => {
  const store = new Map();
  const cache = makeCache({ get: k => Promise.resolve(store.get(k)), set: (k,v) => { store.set(k,v); return Promise.resolve(); } });
  assert.equal(await cache.get('x'), undefined);
  await cache.set('x', { score: 9 });
  assert.deepEqual(await cache.get('x'), { score: 9 });
});

test('makeCache: 跨天失效(同 key 当天命中、次日失效)', async () => {
  const store = new Map();
  const cache = makeCache({ get: k => Promise.resolve(store.get(k)), set: (k, v) => { store.set(k, v); return Promise.resolve(); } });
  await cache.set('x', { score: 9 }, '2026-06-16');
  assert.deepEqual(await cache.get('x', '2026-06-16'), { score: 9, date: '2026-06-16' }); // 当天命中
  assert.equal(await cache.get('x', '2026-06-17'), undefined); // 次日失效
});
