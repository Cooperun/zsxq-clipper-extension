import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAIJson, buildPrompt, scoreOne } from '../lib/ai-scorer.mjs';

test('parseAIJson: 标准 JSON', () => {
  assert.deepEqual(parseAIJson('{"score":8,"reason":"好","tags":["a"]}'),
    { score: 8, reason: '好', tags: ['a'] });
});

test('parseAIJson: 带前后噪声文本仍能提取', () => {
  assert.deepEqual(parseAIJson('好的,结果如下:\n```json\n{"score":7,"reason":"x","tags":[]}\n```'),
    { score: 7, reason: 'x', tags: [] });
});

test('parseAIJson: 非法输入返回 null(不抛错)', () => {
  assert.equal(parseAIJson('完全不是json'), null);
});

test('buildPrompt: 含关注领域与正文', () => {
  const p = buildPrompt({ focus: 'AI编程', text: '某帖子内容' });
  // buildPrompt 返回 GLM messages 数组([{role,content}]),用 join 后做子串断言
  const flat = JSON.stringify(p);
  assert.ok(flat.includes('AI编程'));
  assert.ok(flat.includes('某帖子内容'));
  assert.ok(flat.includes('score'));
});

test('scoreOne: 注入 mock fetch,返回解析结果', async () => {
  const fakeFetch = async () => ({
    json: async () => ({ choices: [{ message: { content: '{"score":9,"reason":"赞","tags":["RAG"]}' } }] })
  });
  const r = await scoreOne({ text: 'x', focus: 'AI' }, { fetch: fakeFetch, apiKey: 'k', model: 'glm-4-flash' });
  assert.equal(r.score, 9);
  assert.deepEqual(r.tags, ['RAG']);
});

test('scoreOne: 默认 provider=zhipu 走智谱 endpoint', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { json: async () => ({ choices: [{ message: { content: '{"score":8,"reason":"x","tags":[]}' } }] }) }; };
  await scoreOne({ text: 'x' }, { fetch: fakeFetch, apiKey: 'k' });
  assert.equal(calls[0], 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
});

test('scoreOne: provider=deepseek 走 deepseek endpoint + 默认 model', async () => {
  const calls = []; const bodies = [];
  const fakeFetch = async (url, opts) => { calls.push(url); bodies.push(JSON.parse(opts.body)); return { json: async () => ({ choices: [{ message: { content: '{"score":8,"reason":"x","tags":[]}' } }] }) }; };
  await scoreOne({ text: 'x' }, { fetch: fakeFetch, apiKey: 'k', provider: 'deepseek' });
  assert.equal(calls[0], 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(bodies[0].model, 'deepseek-chat');
});

test('scoreOne: 自定义 endpoint 覆盖 provider', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { json: async () => ({ choices: [{ message: { content: '{"score":8,"reason":"x","tags":[]}' } }] }) }; };
  await scoreOne({ text: 'x' }, { fetch: fakeFetch, apiKey: 'k', provider: 'custom', endpoint: 'https://my.api/v1/chat' });
  assert.equal(calls[0], 'https://my.api/v1/chat');
});
