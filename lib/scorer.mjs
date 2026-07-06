// lib/scorer.mjs — 质量信号计算(纯函数,零 chrome 依赖)

export function infoDensity({ text = '', codeBlocks = 0, links = 0 }) {
  return Math.floor((text || '').length / 100) + codeBlocks * 5 + links * 3;
}

// 输入归一化后的 topic 摘要:{ likes, comments, digest, text, codeBlocks, links }
export function computeQuality(t) {
  const likes = t.likes || 0;
  const comments = t.comments || 0;
  const density = infoDensity(t);
  const digestBonus = t.digest ? 30 : 0;
  return likes * 1 + comments * 3 + density + digestBonus;
}

// 新鲜度:create_time 越新越高,30 天外归 0。create_time 是 ISO 字符串。
export function computeFreshness(create_time_iso, now = Date.now()) {
  if (!create_time_iso) return 0;
  const days = (now - new Date(create_time_iso).getTime()) / 86400000;
  return Math.max(0, Math.min(1, 1 - days / 30));
}

// 总分:freshness×0.2 + novelty×0.3 + (utility/10)×0.5,×10 取整,clamp 1-10
export function computeTotalScore({ freshness, novelty, utility }) {
  const s = (freshness * 0.2 + novelty * 0.3 + (utility / 10) * 0.5) * 10;
  return Math.round(Math.max(1, Math.min(10, s)));
}
