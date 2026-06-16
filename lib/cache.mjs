// lib/cache.mjs — 评分缓存(存储后端注入,零 chrome 依赖)

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function keyFor(topic) {
  return `${topic.topic_id}_${hash(topic.text || '')}`;
}

// store: { get(key)->Promise<val>, set(key,val)->Promise }
// val 形如 { score, reason, tags, date }
export function makeCache(store) {
  return {
    async get(key, date) {
      const v = await store.get(key);
      if (!v) return undefined;
      if (date && v.date !== date) return undefined; // 跨天失效
      return v;
    },
    async set(key, val, date) {
      return store.set(key, date ? { ...val, date } : { ...val });
    }
  };
}
