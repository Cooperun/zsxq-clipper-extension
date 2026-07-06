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

// 字符 bigram 集合(去空白),用于中文相似度
function bigrams(s) {
  s = (s || '').replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni > 0 ? inter / uni : 0;
}

// 重复度:novelty = 1 - maxOverlap。overlap = 标题 Jaccard×0.6 + 正文前200字 Jaccard×0.4
export function computeNovelty(topic, history = []) {
  if (!history || !history.length) return 1;
  const tTitle = bigrams(topic.title);
  const tText = bigrams((topic.text || '').slice(0, 200));
  let maxOverlap = 0;
  for (const h of history) {
    const ov = jaccard(tTitle, bigrams(h.title)) * 0.6 + jaccard(tText, bigrams(h.textPrefix || '')) * 0.4;
    if (ov > maxOverlap) maxOverlap = ov;
  }
  return Math.max(0, 1 - maxOverlap);
}
