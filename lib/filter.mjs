// lib/filter.mjs — 粗筛(纯函数)
import { computeQuality } from './scorer.mjs';

export const DEFAULT_THRESHOLD = 3; // 质量分下限

function isKeep(t, threshold) {
  if (t.digest) return true;            // 精华无条件保留
  if ((t.likes || 0) >= 3) return true; // 高赞
  if ((t.text || '').length >= 100) return true; // 长帖
  return computeQuality(t) >= threshold;
}

export function coarseFilter(topics, threshold = DEFAULT_THRESHOLD) {
  return topics.filter(t => isKeep(t, threshold));
}
