// lib/ai-scorer.mjs — GLM 调用 + JSON 容错解析(fetch 注入)

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

export function buildPrompt({ focus, text }) {
  return [
    { role: 'system', content: '你是内容筛选助手。按"对该用户的有用程度"给帖子打1-10分。' +
      '只返回 JSON,格式 {"score":数字,"reason":"一句中文理由","tags":["标签"]}。用户关注领域:' + (focus || '通用') },
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

export async function scoreOne(topic, { fetch: f = fetch, apiKey, model = 'glm-4-flash' }) {
  const resp = await f(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages: buildPrompt(topic), temperature: 0.3 })
  });
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = parseAIJson(content);
  return parsed || { score: 0, reason: 'AI 未返回有效评分', tags: [] };
}
