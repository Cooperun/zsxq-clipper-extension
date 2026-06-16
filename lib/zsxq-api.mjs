// lib/zsxq-api.mjs — 拉取星球今日帖子(fetch + token 注入)
// 字段映射以 docs/api-reference.md 实测为准

const BASE = 'https://api.zsxq.com';

export function mapTopic(t) {
  const talk = t.talk || {};
  return {
    topic_id: String(t.topic_id),
    type: t.type,                                              // "talk" / "q&a"
    create_time: t.create_time,                                // ISO 字符串 "2026-06-16T23:54:57.185+0800"
    author: talk.owner?.name || '匿名',
    title: t.title || (talk.text || '').slice(0, 50),
    text: talk.text || '',
    likes: t.likes_count ?? 0,                                  // 实测:likes_count
    comments: t.comments_count ?? 0,                            // 实测:comments_count
    digest: !!t.digested,                                       // 实测:digested (boolean)
    rewards: t.rewards_count ?? 0,                             // 打赏(可选质量信号)
    reading: t.reading_count ?? 0,                             // 阅读(可选质量信号)
    images: (talk.images || []).map(i => i.large?.url || i.thumbnail?.url || i.original?.url).filter(Boolean),
    codeBlocks: ((talk.text || '').match(/```/g) || []).length / 2,
    links: (talk.text || '').match(/https?:\/\//g)?.length || 0
  };
}

// create_time 是 ISO 字符串,减 1ms 避免与上一页最后一条重叠(end_time 闭区间)
function isoMinus1ms(iso) {
  return new Date(new Date(iso).getTime() - 1).toISOString();
}

// 认证靠 httpOnly cookie:fetch 必须 credentials:'include'(实测,见 docs/api-reference.md)
// isBeforeToday(create_time_iso) → bool,决定翻页终止
export async function fetchToday({ groupId, fetch: f = fetch, isBeforeToday, maxPages = 20, count = 20 }) {
  const out = [];
  let endTime = null;
  for (let p = 0; p < maxPages; p++) {
    const params = new URLSearchParams({ scope: 'all', count: String(count) });
    if (endTime) params.set('end_time', endTime);
    const resp = await f(`${BASE}/v2/groups/${groupId}/topics?${params}`, { credentials: 'include' });
    const data = await resp.json();
    if (!data.succeeded) throw new Error('zsxq API 错误: ' + (data.error || data.code));
    const topics = data?.resp_data?.topics || [];
    if (!topics.length) break;
    for (const t of topics) {
      if (isBeforeToday && isBeforeToday(t.create_time)) return out; // 翻到昨天,停
      out.push(mapTopic(t));
    }
    if (topics.length < count) break; // 不满一页 = 到底
    endTime = isoMinus1ms(topics[topics.length - 1].create_time); // 下一页游标
  }
  return out;
}
