// lib/feedback.mjs — 反馈存储 + token 用量记录(存储后端注入,零 chrome 依赖)
// store 接口同 cache.mjs:{ get(key)->Promise<val>, set(key,val)->Promise }

const FEEDBACK_KEY = 'feedback';
const TOKEN_KEY = 'tokenUsage';
const FEEDBACK_CAP = 100;

export async function getFeedback(store) {
  return (await store.get(FEEDBACK_KEY)) || [];
}

// entry: { topic_id, title, textSnippet, aiScore, userScore, reason, ts }
// 同 topic_id 覆盖(保留最新);超 cap 淘汰插入序最前(== ts 最小,调用方传单调递增 ts)。
export async function addFeedback(store, entry, cap = FEEDBACK_CAP) {
  const all = await getFeedback(store);
  const next = [...all.filter(x => x.topic_id !== entry.topic_id), entry];
  while (next.length > cap) next.shift();
  await store.set(FEEDBACK_KEY, next);
  return next;
}

// 纠偏项:|userScore-aiScore|>=2,按 ts 降序(最近在前),取前 limit 条。
export function corrections(feedback = [], limit = 5) {
  return feedback
    .filter(x => Math.abs((x.userScore || 0) - (x.aiScore || 0)) >= 2)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, limit);
}

export async function getTokenUsage(store) {
  return (await store.get(TOKEN_KEY)) || {};
}

// usage: OpenAI 兼容 { prompt_tokens, completion_tokens, total_tokens }(可能缺);null 则跳过。
// dateStr/today: 'YYYY-MM-DD'(调用方传,便于测)。剪枝 keepDays 天前的键。
export async function recordTokens(store, dateStr, usage, { today = dateStr, keepDays = 30 } = {}) {
  if (!usage) return await getTokenUsage(store);
  const all = await getTokenUsage(store);
  const prev = all[dateStr] || { prompt: 0, completion: 0, total: 0, calls: 0 };
  all[dateStr] = {
    prompt: prev.prompt + (usage.prompt_tokens || 0),
    completion: prev.completion + (usage.completion_tokens || 0),
    total: prev.total + (usage.total_tokens || 0),
    calls: prev.calls + 1
  };
  const cutoff = daysBefore(today, keepDays);
  for (const k of Object.keys(all)) if (k < cutoff) delete all[k];
  await store.set(TOKEN_KEY, all);
  return all;
}

// 'YYYY-MM-DD' 减 N 天(UTC,字符串可比:YYYY-MM-DD 字典序==时间序)
function daysBefore(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
