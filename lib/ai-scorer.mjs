// lib/ai-scorer.mjs — GLM 调用 + JSON 容错解析(fetch 注入)

import { corrections } from './feedback.mjs';

export const PROVIDERS = {
  zhipu:    { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
  deepseek: { endpoint: 'https://api.deepseek.com/v1/chat/completions',          model: 'deepseek-chat' },
};

// endpoint/model 优先级:显式传入 > provider 默认 > zhipu 默认
export function resolveEndpoint({ provider = 'zhipu', endpoint, model } = {}) {
  const p = PROVIDERS[provider] || PROVIDERS.zhipu;
  return { endpoint: endpoint || p.endpoint, model: model || p.model };
}

export function buildPrompt({ focus, text, feedback, guidance } = {}) {
  let sys = '你是内容筛选助手。按"对该用户的有用程度"给帖子打1-10分。' +
    '只返回 JSON,格式 {"score":数字,"reason":"一句中文理由","tags":["标签"]}。用户关注领域:' + (focus || '通用');
  if (guidance) sys += '\n\n【评分指引】\n' + guidance;
  const corr = corrections(feedback || []);
  if (corr.length) {
    sys += '\n\n【用户品味参考(最近纠偏,据此校准你的打分倾向)】';
    for (const c of corr) {
      sys += `\n- 《${c.title || ''}》正文:${(c.textSnippet || '').slice(0, 80)}… AI 给 ${c.aiScore} 分,用户认为该 ${c.userScore} 分,理由:${c.reason || ''}`;
    }
  }
  return [
    { role: 'system', content: sys },
    { role: 'user', content: '帖子内容:\n' + (text || '').slice(0, 1500) }
  ];
}

export function parseAIJson(raw) {
  if (!raw) return null;
  // 优先直接解析;失败则提取第一个 {...}
  try { return JSON.parse(raw); } catch (_) {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (typeof obj.score === 'number') return obj;
  } catch (_) {}
  return null;
}

export async function scoreOne(topic, { fetch: f = fetch, apiKey, model, provider = 'zhipu', endpoint } = {}) {
  const { endpoint: url, model: useModel } = resolveEndpoint({ provider, endpoint, model });
  const resp = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: useModel, messages: buildPrompt(topic), temperature: 0.3 })
  });
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = parseAIJson(content);
  const usage = data?.usage || null;
  return parsed ? { ...parsed, usage } : { score: 0, reason: 'AI 未返回有效评分', tags: [], usage };
}

// C: 用全部 feedback 让 LLM 综合成评分指引 guidance。
export function buildGuidancePrompt(feedback = []) {
  const items = feedback.length
    ? feedback.map(f => `- 《${f.title || ''}》AI=${f.aiScore},用户=${f.userScore}:${f.reason || ''}`).join('\n')
    : '(暂无反馈)';
  return [
    { role: 'system', content: '你是一个评分校准器。下面是用户对历史帖子评分的纠偏反馈(AI 原先评 aiScore,用户认为该 userScore)。请综合成一段简洁的"评分指引"(不超过200字),提炼用户偏好的选题规律与加减分倾向。直接输出指引文本,不要 JSON。' },
    { role: 'user', content: items }
  ];
}

export async function regenerateGuidance({ feedback, fetch: f = fetch, apiKey, model, provider = 'zhipu', endpoint } = {}) {
  const { endpoint: url, model: useModel } = resolveEndpoint({ provider, endpoint, model });
  const resp = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: useModel, messages: buildGuidancePrompt(feedback), temperature: 0.4 })
  });
  const data = await resp.json();
  const guidance = (data?.choices?.[0]?.message?.content || '').trim();
  return { guidance: guidance.slice(0, 600), usage: data?.usage || null };
}
