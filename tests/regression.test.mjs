import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOne } from '../lib/ai-scorer.mjs';
import { readArchiveSamples } from './helpers.mjs';

// 调用真实 GLM paas v4,需 GLM_API_KEY;无 key 时跳过,保持 npm test 绿色。
const KEY = process.env.GLM_API_KEY;

test('已入库帖子应得较高分(>=6)', { skip: !KEY && '需 GLM_API_KEY 才能运行(调用真实 GLM)' }, async () => {
  const samples = readArchiveSamples();
  for (const s of samples) {
    const r = await scoreOne({ text: s.text, focus: '' }, { apiKey: KEY, model: 'glm-4-flash' });
    if (r.score < 6) console.log('LOW SCORE:', r.score, '|', s.text.slice(0, 40), '|', r.reason);
    assert.ok(r.score >= 6, `正样本得分过低:${r.score}`);
  }
});
