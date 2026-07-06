import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTopic, fetchToday, fetchComments, mapComment } from '../lib/zsxq-api.mjs';

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

test('fetchToday: mock fetch 单页返回(scope=all,credentials include,大整数 id 精度保留)', async () => {
  // 注意:不能用 JSON.stringify({topic_id: 45544248881118548})——JS 数字字面量在 parse 阶段就
  // 被截成 ...540。真实 API 返回的是原始十进制文本,故这里手拼 text 保末位精度,验证 parseZsxqJson。
  const text = '{"succeeded":true,"code":0,"resp_data":{"topics":[' +
    '{"topic_id":45544248881118548,"create_time":"2026-06-16T23:54:57.185+0800","likes_count":5,"comments_count":0,"digested":false,"talk":{"text":"' + 'a'.repeat(120) + '","owner":{"name":"x"}}}' +
    ']}}';
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { text: async () => text }; };
  const topics = await fetchToday({ groupId: 'g1', fetch: fakeFetch, isBeforeToday: () => false });
  assert.equal(topics.length, 1);
  assert.equal(topics[0].topic_id, '45544248881118548'); // 关键:大整数末位未被截断
  assert.ok(calls[0].url.includes('/v2/groups/g1/topics'));
  assert.ok(calls[0].url.includes('scope=all'));
  assert.equal(calls[0].opts.credentials, 'include'); // 认证靠 cookie
});

test('mapComment: 字段映射(实测字段)', () => {
  const c = mapComment({ text: '好帖', owner: { name: '张三', user_id: 123 }, likes_count: 5 });
  assert.deepEqual(c, { text: '好帖', owner: '张三', likes: 5 });
});

test('fetchComments: URL 不带 group + cookie + 按 likes 降序', async () => {
  // 手拼 text:comment_id/user_id 用真实大整数,验证 parseZsxqJson 也覆盖评论侧 ID 精度。
  const text = '{"succeeded":true,"resp_data":{"comments":[' +
    '{"comment_id":45544248881118549,"text":"评论A","owner":{"name":"a","user_id":45544248881118550},"likes_count":2},' +
    '{"comment_id":45544248881118551,"text":"评论B","owner":{"name":"b","user_id":45544248881118552},"likes_count":10}' +
    ']}}';
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { text: async () => text } };
  const cs = await fetchComments({ topicId: '45544248881118548', fetch: fakeFetch });
  assert.ok(calls[0].url.includes('/v2/topics/45544248881118548/comments'), 'URL 应不带 group: ' + calls[0].url);
  assert.ok(!calls[0].url.includes('/groups/'), '不应含 /groups/: ' + calls[0].url);
  assert.equal(calls[0].opts.credentials, 'include');
  assert.equal(cs.length, 2);
  assert.equal(cs[0].likes, 10); // 降序
  assert.equal(cs[0].owner, 'b'); // 降序对应作者
});
