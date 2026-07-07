// lib/zsxq-api.mjs — 拉取星球今日帖子(fetch + token 注入)
// 字段映射以 docs/api-reference.md 实测为准

const BASE = 'https://api.zsxq.com';

// zsxq 的 topic_id/comment_id/user_id 是 int64、超 2^53,resp.json() 会截断末位。
// 先把这些 ID 字段加引号转字符串再 parse(正则只匹配 JSON 键值结构,不误伤字符串内容里的字面量)。
function parseZsxqJson(text) {
  const safe = text.replace(/"(topic_id|topic_uid|comment_id|user_id)"\s*:\s*(\d+)/g, '"$1":"$2"');
  return JSON.parse(safe);
}

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

// zsxq 限流(code 1059 "内部错误")退避重试:遇 1059 指数退避(1s/2s/4s)重试最多 retries 次;
// 非限流错误(如 14001/19301)立即抛。sleep 可注入(测试用)。
export async function fetchZsxqWithRetry(url, f, { retries = 3, sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await f(url, { credentials: 'include' });
    const data = parseZsxqJson(await resp.text());
    if (data.succeeded) return data;
    last = data;
    if (data.code !== 1059) break; // 非限流,不重试
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`zsxq API 错误: ${last?.error || '未知'} [code ${last?.code}]`);
}

// 认证靠 httpOnly cookie:fetch 必须 credentials:'include'(实测,见 docs/api-reference.md)
// isBeforeToday(create_time_iso) → bool,决定翻页终止
// pageDelay:翻页间隔(防限流,实测 30 天高速翻页会触发 1059)
export async function fetchToday({ groupId, fetch: f = fetch, isBeforeToday, maxPages = 20, count = 20, pageDelay = 400 }) {
  const out = [];
  let endTime = null;
  for (let p = 0; p < maxPages; p++) {
    if (p > 0 && pageDelay > 0) await new Promise(r => setTimeout(r, pageDelay)); // 翻页间隔,防限流
    const params = new URLSearchParams({ scope: 'all', count: String(count) });
    if (endTime) params.set('end_time', endTime);
    const data = await fetchZsxqWithRetry(`${BASE}/v2/groups/${groupId}/topics?${params}`, f);
    const topics = data?.resp_data?.topics || [];
    if (!topics.length) break;
    for (const t of topics) {
      if (isBeforeToday && isBeforeToday(t.create_time)) return out; // 翻出时间范围,停
      out.push(mapTopic(t));
    }
    if (topics.length < count) break; // 不满一页 = 到底
    endTime = isoMinus1ms(topics[topics.length - 1].create_time); // 下一页游标
  }
  return out;
}

export function mapComment(c) {
  return {
    text: c.text || '',
    owner: c.owner?.name || '匿名',
    likes: c.likes_count ?? 0
  };
}

// 拉某 topic 的评论,按 likes 降序。端点 /v2/topics/<topic_id>/comments(不带 group)。
// topicId 必须是精确字符串(见 parseZsxqJson);响应同样走 parseZsxqJson 保 comment_id 精度。
export async function fetchComments({ topicId, fetch: f = fetch, count = 20 }) {
  const url = `${BASE}/v2/topics/${topicId}/comments?count=${count}`;
  const data = await fetchZsxqWithRetry(url, f); // 含 1059 退避重试
  const comments = (data?.resp_data?.comments || []).map(mapComment);
  comments.sort((a, b) => b.likes - a.likes);
  return comments;
}
