import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTopic, fetchToday } from '../lib/zsxq-api.mjs';

test('mapTopic: API 原始字段 → 内部摘要(实测字段)', () => {
  const raw = {
    topic_id: 22255245281241280, type: 'talk',
    create_time: '2026-06-16T23:54:57.185+0800', title: '',
    likes_count: 12, comments_count: 3, digested: true,
    talk: { owner: { name: '张三' }, text: '正文', images: [
      { image_id: 1, type: 'png', thumbnail: { url: 'http://t' }, large: { url: 'http://l' }, original: { url: 'http://o' } }
    ] }
  };
  const m = mapTopic(raw);
  assert.equal(m.topic_id, '22255245281241280');
  assert.equal(m.author, '张三');
  assert.equal(m.text, '正文');
  assert.equal(m.likes, 12);
  assert.equal(m.comments, 3);
  assert.equal(m.digest, true);
  assert.equal(m.create_time, '2026-06-16T23:54:57.185+0800');
  assert.deepEqual(m.images, ['http://l']); // 取 large.url
});

test('fetchToday: mock fetch 单页返回(scope=all,credentials include,无 token)', async () => {
  const page = { succeeded: true, code: 0, resp_data: { topics: [
    { topic_id: 't1', create_time: '2026-06-16T23:54:57.185+0800', likes_count: 5, comments_count: 0, digested: false, talk: { text: 'a'.repeat(120), owner: { name: 'x' } } }
  ] } };
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { json: async () => page }; };
  const topics = await fetchToday({ groupId: 'g1', fetch: fakeFetch, isBeforeToday: () => false });
  assert.equal(topics.length, 1);
  assert.ok(calls[0].url.includes('/v2/groups/g1/topics'));
  assert.ok(calls[0].url.includes('scope=all'));
  assert.equal(calls[0].opts.credentials, 'include'); // 认证靠 cookie
});
