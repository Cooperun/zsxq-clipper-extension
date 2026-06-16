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
