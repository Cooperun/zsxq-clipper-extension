import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFeedback, addFeedback, corrections, recordTokens, getTokenUsage } from '../lib/feedback.mjs';

function mockStore() {
  const m = new Map();
  return { get: async k => m.get(k), set: async (k, v) => { m.set(k, v); } };
}

test('addFeedback: 新增 + 同 topic_id 覆盖 + 上限淘汰最旧', async () => {
  const s = mockStore();
  await addFeedback(s, { topic_id: 't1', title: 'A', aiScore: 9, userScore: 5, reason: 'r1', ts: 1 });
  await addFeedback(s, { topic_id: 't2', title: 'B', aiScore: 8, userScore: 7, reason: 'r2', ts: 2 });
  let all = await addFeedback(s, { topic_id: 't1', title: 'A2', aiScore: 9, userScore: 6, reason: 'r1b', ts: 3 });
  assert.equal(all.length, 2);                 // t1 覆盖,不新增
  assert.equal(all.find(x => x.topic_id === 't1').title, 'A2'); // 覆盖为最新
  // 凑满 cap=3,再加一条超限 → 淘汰 ts 最小的(t2, ts=2)
  await addFeedback(s, { topic_id: 't3', title: 'C', aiScore: 7, userScore: 7, reason: 'r3', ts: 4 }, 3);
  await addFeedback(s, { topic_id: 't4', title: 'D', aiScore: 7, userScore: 7, reason: 'r4', ts: 5 }, 3);
  all = await getFeedback(s);
  assert.equal(all.length, 3);
  assert.ok(!all.find(x => x.topic_id === 't2')); // ts 最小的被淘汰
});

test('corrections: 取 |userScore-aiScore|>=2,按 ts 降序取前5', () => {
  const fb = [
    { topic_id: 'a', title: 'a', aiScore: 9, userScore: 9, reason: '', ts: 1 }, // 差0,排除
    { topic_id: 'b', title: 'b', aiScore: 9, userScore: 5, reason: 'rb', ts: 2 }, // 差4,留
    { topic_id: 'c', title: 'c', aiScore: 7, userScore: 9, reason: 'rc', ts: 3 }, // 差2,留
    { topic_id: 'd', title: 'd', aiScore: 8, userScore: 8, reason: 'rd', ts: 4 }, // 差0,排除
  ];
  const c = corrections(fb);
  assert.equal(c.length, 2);
  assert.equal(c[0].topic_id, 'c'); // ts 降序:3>2
  assert.equal(c[1].topic_id, 'b');
});

test('recordTokens: 累加当日 + calls + 剪枝>30天', async () => {
  const s = mockStore();
  await s.set('tokenUsage', { '2026-06-01': { prompt: 10, completion: 5, total: 15, calls: 1 } }); // >30天前
  await recordTokens(s, '2026-07-07', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, { today: '2026-07-07' });
  await recordTokens(s, '2026-07-07', { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }); // 再记一次
  const u = await getTokenUsage(s);
  assert.deepEqual(u['2026-07-07'], { prompt: 150, completion: 30, total: 180, calls: 2 });
  assert.ok(!u['2026-06-01'], '旧记录应被剪枝');
});

test('recordTokens: usage 为 null 时跳过', async () => {
  const s = mockStore();
  await recordTokens(s, '2026-07-07', null);
  const u = await getTokenUsage(s);
  assert.deepEqual(u, {});
});
