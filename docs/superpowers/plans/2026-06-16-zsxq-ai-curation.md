# 知识星球 AI 精选筛选层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 zsxq-clipper 扩展上增加一个 AI 前置筛选层——拉取当前星球今日全部帖子,用质量信号粗筛 + GLM 逐条评分,在右侧精选栏只展示高分帖,用户点 `[收]` 通过 File System Access API 落盘到 `~/zsxq-clips/`。

**Architecture:** 纯扩展(MV3),无本地 server 依赖。纯逻辑(评分/粗筛/AI/缓存/拉取)抽成 ES module 放 `lib/`,既被 `background.js`(ES module service worker)import,又被 `node:test` 单测;`content.js` 只负责精选栏 UI + 触发 + File System Access 落盘;`options` 页填 API key/关注领域。最终收藏仍手动点按,绝不自动入库。

**Tech Stack:** Chrome MV3、ES modules、File System Access API、智谱 GLM(OpenAI 兼容接口)、Node 内置 `node:test`(零依赖测试)。

**Spec:** `docs/superpowers/specs/2026-06-16-zsxq-ai-curation-design.md`

---

## File Structure

| 文件 | 职责 | 创建/修改 |
|------|------|-----------|
| `docs/api-reference.md` | 知识星球 API 实测参考(认证/端点/字段) | Create |
| `package.json` | 测试脚本,`"type":"module"` | Create |
| `lib/scorer.mjs` | 质量信号计算(纯函数) | Create |
| `lib/filter.mjs` | 粗筛阈值过滤(纯函数) | Create |
| `lib/ai-scorer.mjs` | 调 GLM + JSON 容错解析 | Create |
| `lib/cache.mjs` | 评分缓存(存储抽象注入) | Create |
| `lib/zsxq-api.mjs` | 拉取星球今日帖子(fetch + token 注入) | Create |
| `background.js` | ESM service worker:编排 scanToday 消息 | Modify(改 ESM) |
| `content.js` | 精选栏 UI + 扫描触发 + File System Access 落盘 | Modify |
| `options.html` / `options.js` | 设置页:API key/关注领域/授权目录 | Create |
| `manifest.json` | 权限(storage/downloads)、background type:module、options_page、host | Modify |
| `tests/*.test.mjs` | 纯逻辑单测 | Create |
| `README.md` | 更新用法 | Modify |

**关键边界**:`lib/*` 是纯逻辑 + 注入依赖(fetch/storage),零 `chrome.*` 依赖 → 可被 Node 单测。`chrome.*` 只出现在 `background.js`/`content.js`/`options.js` 这些胶水层。

---

## Task 1: 实测知识星球 API,产出 api-reference.md

**Files:**
- Create: `docs/api-reference.md`

这是地基,后续所有 fetch 代码以本文档为准。

- [ ] **Step 1: 用 Chrome DevTools 抓真实请求**

在 Chrome 打开 `wx.zsxq.com` 登录某星球,按 F12 → Network → 过滤 `topics` → 滚动加载。找到 `api.zsxq.com/v2/groups/.../topics` 请求,记录到 `docs/api-reference.md`:
- 完整 URL(含 group_id)
- Request Headers 里的认证头名称与格式(预期是 `Authorization`,记录是 `Authorization: <token>` 还是 `Bearer <token>` 还是别的)
- token 来源:检查 DevTools → Application → Local Storage / Cookies,找 `zsxq_access_token` 之类的 key 名
- Query 参数:`count` / `scope` / `end_time` 的实际取值

- [ ] **Step 2: 记录响应字段结构**

把一条 topic 的 JSON 粘进 `docs/api-reference.md`,确认这些字段的真实路径(查证说是 `resp_data.topics[].talk.text` 等,以实测为准):
- 正文:`topic.talk.text`?
- 点赞/评论:`like_count` / `comments_count`?(还是 `show_likes_count`?)
- 精华标志:字段名与真值(`type=="digest"`? 还是 `talk.digest`? 还是 `is_digest`?)
- 作者:`topic.owner.name`? `topic.talk.owner.name`?
- 图片:`topic.talk.images[].url`?

- [ ] **Step 3: 确认"今日"过滤方式**

查证说分页用 `end_time`(上一页最后 topic 的 `create_time` - 1ms)。确认:无 `begin_time` 时是否返回最新一页?要拿"今日全部",应循环 `end_time` 翻页直到 `create_time` 落到昨天。记录翻页终止条件。

- [ ] **Step 4: Commit**

```bash
git -C /Users/byron/zsxq-clipper add docs/api-reference.md
git -C /Users/byron/zsxq-clipper commit -m "docs: 实测知识星球 API 参考"
```

> ⚠️ **后续 Task 8 的 fetch 代码以本任务产出的 `docs/api-reference.md` 为准。** 若实测发现字段/认证与 plan 里的查证默认值不同,先更新 api-reference.md,再据此调整 Task 8。

---

## Task 2: 测试基础设施(package.json + ESM)

**Files:**
- Create: `package.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "zsxq-clipper",
  "version": "5.5.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: 建测试目录,写一个冒烟测试验证 runner**

Create `tests/smoke.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node:test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: 运行,确认通过**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/`
Expected: `tests/smoke.test.mjs` PASS

- [ ] **Step 4: Commit**

```bash
git -C /Users/byron/zsxq-clipper add package.json tests/smoke.test.mjs
git -C /Users/byron/zsxq-clipper commit -m "test: 搭建 node:test 测试基础设施"
```

---

## Task 3: 质量信号计算 lib/scorer.mjs

**Files:**
- Create: `lib/scorer.mjs`
- Create: `tests/scorer.test.mjs`

- [ ] **Step 1: 写失败测试**

Create `tests/scorer.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuality, infoDensity } from '../lib/scorer.mjs';

test('infoDensity: 字数+代码块+链接叠加', () => {
  assert.equal(infoDensity({ text: 'a'.repeat(300), codeBlocks: 2, links: 3 }),
    3 + 2 * 5 + 3 * 3); // 字数300/100=3, 代码2*5, 链接3*3 → 20
});

test('computeQuality: 精华帖加分', () => {
  const base = { likes: 5, comments: 2, digest: false, text: 'x'.repeat(200), codeBlocks: 0, links: 0 };
  const digest = { ...base, digest: true };
  assert.ok(computeQuality(digest) > computeQuality(base) + 25);
});

test('computeQuality: 评论权重高于点赞', () => {
  const a = { likes: 10, comments: 0, digest: false, text: 'x'.repeat(200), codeBlocks: 0, links: 0 };
  const b = { likes: 0, comments: 5, digest: false, text: 'x'.repeat(200), codeBlocks: 0, links: 0 };
  assert.ok(computeQuality(b) > computeQuality(a)); // 5评论*2=10 > 10赞*1=10? 需评论系数更高
});
```

> 注:第三个测试要求评论系数 > 点赞系数。Step 3 实现里评论用 ×3、点赞 ×1,5×3=15 > 10×1=10 ✓。

- [ ] **Step 2: 运行,确认失败**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/scorer.test.mjs`
Expected: FAIL(`computeQuality`/`infoDensity` 未定义)

- [ ] **Step 3: 实现 lib/scorer.mjs**

```javascript
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/scorer.test.mjs`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/byron/zsxq-clipper add lib/scorer.mjs tests/scorer.test.mjs
git -C /Users/byron/zsxq-clipper commit -m "feat: 质量信号计算 lib/scorer"
```

---

## Task 4: 粗筛 lib/filter.mjs

**Files:**
- Create: `lib/filter.mjs`
- Create: `tests/filter.test.mjs`

- [ ] **Step 1: 写失败测试**

Create `tests/filter.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coarseFilter, DEFAULT_THRESHOLD } from '../lib/filter.mjs';

const mk = (over) => ({ likes: 0, comments: 0, digest: false, text: '', codeBlocks: 0, links: 0, ...over });

test('低质帖被过滤:无赞无评论非精华且字数少', () => {
  assert.equal(coarseFilter([mk({ text: '短' })]).length, 0);
});

test('精华帖无条件保留', () => {
  assert.equal(coarseFilter([mk({ digest: true, text: '短' })]).length, 1);
});

test('高赞帖保留', () => {
  assert.equal(coarseFilter([mk({ likes: 10 })]).length, 1);
});

test('长帖保留(信息量足够)', () => {
  assert.equal(coarseFilter([mk({ text: 'x'.repeat(150) })]).length, 1);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/filter.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 lib/filter.mjs**

```javascript
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/filter.test.mjs`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/byron/zsxq-clipper add lib/filter.mjs tests/filter.test.mjs
git -C /Users/byron/zsxq-clipper commit -m "feat: 粗筛 lib/filter"
```

---

## Task 5: AI 评分 lib/ai-scorer.mjs(含 JSON 容错)

**Files:**
- Create: `lib/ai-scorer.mjs`
- Create: `tests/ai-scorer.test.mjs`

- [ ] **Step 1: 写失败测试(含容错解析)**

Create `tests/ai-scorer.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAIJson, buildPrompt, scoreOne } from '../lib/ai-scorer.mjs';

test('parseAIJson: 标准 JSON', () => {
  assert.deepEqual(parseAIJson('{"score":8,"reason":"好","tags":["a"]}'),
    { score: 8, reason: '好', tags: ['a'] });
});

test('parseAIJson: 带前后噪声文本仍能提取', () => {
  assert.deepEqual(parseAIJson('好的,结果如下:\n```json\n{"score":7,"reason":"x","tags":[]}\n```'),
    { score: 7, reason: 'x', tags: [] });
});

test('parseAIJson: 非法输入返回 null(不抛错)', () => {
  assert.equal(parseAIJson('完全不是json'), null);
});

test('buildPrompt: 含关注领域与正文', () => {
  const p = buildPrompt({ focus: 'AI编程', text: '某帖子内容' });
  assert.ok(p.includes('AI编程'));
  assert.ok(p.includes('某帖子内容'));
  assert.ok(p.includes('score'));
});

test('scoreOne: 注入 mock fetch,返回解析结果', async () => {
  const fakeFetch = async () => ({
    json: async () => ({ choices: [{ message: { content: '{"score":9,"reason":"赞","tags":["RAG"]}' } }] })
  });
  const r = await scoreOne({ text: 'x', focus: 'AI' }, { fetch: fakeFetch, apiKey: 'k', model: 'glm-4-flash' });
  assert.equal(r.score, 9);
  assert.deepEqual(r.tags, ['RAG']);
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/ai-scorer.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 lib/ai-scorer.mjs**

```javascript
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/ai-scorer.test.mjs`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/byron/zsxq-clipper add lib/ai-scorer.mjs tests/ai-scorer.test.mjs
git -C /Users/byron/zsxq-clipper commit -m "feat: GLM 评分 lib/ai-scorer(含 JSON 容错)"
```

---

## Task 6: 评分缓存 lib/cache.mjs

**Files:**
- Create: `lib/cache.mjs`
- Create: `tests/cache.test.mjs`

- [ ] **Step 1: 写失败测试**

Create `tests/cache.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCache, keyFor } from '../lib/cache.mjs';

test('keyFor: 同 topic+内容同 key', () => {
  assert.equal(keyFor({ topic_id: '1', text: 'abc' }), keyFor({ topic_id: '1', text: 'abc' }));
  assert.notEqual(keyFor({ topic_id: '1', text: 'abc' }), keyFor({ topic_id: '1', text: 'abcd' }));
});

test('makeCache: get 命中/未命中', async () => {
  const store = new Map();
  const cache = makeCache({ get: k => Promise.resolve(store.get(k)), set: (k,v) => { store.set(k,v); return Promise.resolve(); } });
  assert.equal(await cache.get('x'), undefined);
  await cache.set('x', { score: 9 });
  assert.deepEqual(await cache.get('x'), { score: 9 });
});

test('makeCache: 跨天失效(同 key 当天命中、次日失效)', async () => {
  const store = new Map();
  const cache = makeCache({ get: k => Promise.resolve(store.get(k)), set: (k, v) => { store.set(k, v); return Promise.resolve(); } });
  await cache.set('x', { score: 9 }, '2026-06-16');
  assert.deepEqual(await cache.get('x', '2026-06-16'), { score: 9, date: '2026-06-16' }); // 当天命中
  assert.equal(await cache.get('x', '2026-06-17'), undefined); // 次日失效
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/cache.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 lib/cache.mjs**

```javascript
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
      return store.set(key, { ...val, date });
    }
  };
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/cache.test.mjs`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/byron/zsxq-clipper add lib/cache.mjs tests/cache.test.mjs
git -C /Users/byron/zsxq-clipper commit -m "feat: 评分缓存 lib/cache(跨天失效)"
```

---

## Task 7: 星球 API 拉取 lib/zsxq-api.mjs

**Files:**
- Create: `lib/zsxq-api.mjs`
- Create: `tests/zsxq-api.test.mjs`

> 字段映射以 Task 1 的 `docs/api-reference.md` 为准。下面用查证的默认结构(`resp_data.topics[]`,`talk.text`,`like_count` 等),实测不符则改这里的 `mapTopic`。

- [ ] **Step 1: 写失败测试**

Create `tests/zsxq-api.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTopic, fetchToday } from '../lib/zsxq-api.mjs';

test('mapTopic: API 原始字段 → 内部摘要(实测字段)', () => {
  const raw = {
    topic_id: 22255245281241280, type: 'talk',
    create_time: '2026-06-16T23:54:57.185+0800', title: '',
    likes_count: 12, comments_count: 3, digested: true,
    talk: { owner: { name: '张三' }, text: '正文', images: [
      { image_id: 1, type: 'png', thumbnail: { url: 'http://t' }, large: { url: 'http://l' }, original: { url: 'http://o' } }
    ] }
  };
  const m = mapTopic(raw);
  assert.equal(m.topic_id, '22255245281241280');
  assert.equal(m.author, '张三');
  assert.equal(m.text, '正文');
  assert.equal(m.likes, 12);
  assert.equal(m.comments, 3);
  assert.equal(m.digest, true);
  assert.equal(m.create_time, '2026-06-16T23:54:57.185+0800');
  assert.deepEqual(m.images, ['http://l']); // 取 large.url
});

test('fetchToday: mock fetch 单页返回(scope=all,credentials include,无 token)', async () => {
  const page = { succeeded: true, code: 0, resp_data: { topics: [
    { topic_id: 't1', create_time: '2026-06-16T23:54:57.185+0800', likes_count: 5, comments_count: 0, digested: false, talk: { text: 'a'.repeat(120), owner: { name: 'x' } } }
  ] } };
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { json: async () => page }; };
  const topics = await fetchToday({ groupId: 'g1', fetch: fakeFetch, isBeforeToday: () => false });
  assert.equal(topics.length, 1);
  assert.ok(calls[0].url.includes('/v2/groups/g1/topics'));
  assert.ok(calls[0].url.includes('scope=all'));
  assert.equal(calls[0].opts.credentials, 'include'); // 认证靠 cookie
});
```

- [ ] **Step 2: 运行,确认失败**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/zsxq-api.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 lib/zsxq-api.mjs**

```javascript
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `cd /Users/byron/zsxq-clipper && node --test tests/zsxq-api.test.mjs`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/byron/zsxq-clipper add lib/zsxq-api.mjs tests/zsxq-api.test.mjs
git -C /Users/byron/zsxq-clipper commit -m "feat: 星球 API 拉取 lib/zsxq-api"
```

---

## Task 8: background.js 改 ESM + scanToday 编排

**Files:**
- Modify: `background.js`(整体改写为 ESM,保留现有 clip/fetchArticle 消息)
- Modify: `manifest.json`(`background` 加 `"type":"module"`)— 见 Task 12 统一改,本任务先只改 background.js

- [ ] **Step 1: 把 background.js 改写为 ESM 并加 scanToday 编排**

```javascript
// background.js v6 — ESM Service Worker
import { coarseFilter } from './lib/filter.mjs';
import { scoreOne } from './lib/ai-scorer.mjs';
import { makeCache, keyFor } from './lib/cache.mjs';
import { fetchToday } from './lib/zsxq-api.mjs';

const SERVER = 'http://127.0.0.1:8765/clip'; // 保留作可选 fallback
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 缓存后端用 chrome.storage.local
const store = {
  async get(k) { return (await chrome.storage.local.get(k))[k]; },
  async set(k, v) { await chrome.storage.local.set({ [k]: v }); }
};
const cache = makeCache(store);

// 解析短链接(沿用 v5.5)
async function resolveShortUrl(url) {
  if (!url.includes('t.zsxq.com')) return url;
  try {
    const resp = await fetch(url, { method: 'HEAD', redirect: 'follow', credentials: 'include' });
    return resp.url || url;
  } catch (e) { console.warn('[剪藏] 短链接解析失败:', url, e.message); return url; }
}

// 后台 tab 打开外链等 SPA 渲染后提取 innerHTML(沿用 v5.5)
async function fetchArticleViaTab(url) {
  const realUrl = await resolveShortUrl(url);
  const tab = await chrome.tabs.create({ url: realUrl, active: false });
  try {
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      try {
        const r = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const talk = document.querySelector('app-talk-content');
            if (talk && talk.textContent.length > 100) return { ready: true };
            const editor = document.querySelector('.ql-editor') || document.querySelector('.milkdown-editor');
            if (editor && editor.textContent.length > 100) return { ready: true };
            const cs = document.querySelectorAll('.content');
            for (const el of cs) if (el.textContent.length > 200) return { ready: true };
            return { ready: (document.body?.textContent || '').length > 500 };
          }
        });
        if (r?.[0]?.result?.ready) break;
      } catch (e) { /* tab 还在加载 */ }
    }
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const editor = document.querySelector('.ql-editor') || document.querySelector('.milkdown-editor');
        const talk = document.querySelector('app-talk-content');
        const gc = document.querySelector('.content');
        const hasGc = gc && gc.textContent?.length > 100;
        const target = editor || talk || (hasGc ? gc : null) || document.body;
        return target.innerHTML;
      }
    });
    return r?.[0]?.result || null;
  } finally { try { await chrome.tabs.remove(tab.id); } catch (e) {} }
}

// 新增:scanToday 编排
async function handleScanToday({ groupId, todayStr }) {
  const { apiKey, focus, model } = await chrome.storage.local.get(['apiKey', 'focus', 'model']);
  if (!apiKey) return { ok: false, error: '未设置 API key,请到扩展设置页填写' };

  const isBeforeToday = (ts) => new Date(ts).toDateString() !== new Date().toDateString();
  let topics;
  try {
    // 认证靠 httpOnly cookie(credentials:'include',见 lib/zsxq-api.mjs + docs/api-reference.md)
    // background SW 对 host-permission 域 fetch 会带 cookie;若实测 401,降级改由 content.js 发起 fetch
    topics = await fetchToday({ groupId, isBeforeToday });
  } catch (e) { return { ok: false, error: '拉取星球失败(登录态?):' + e.message }; }

  const candidates = coarseFilter(topics);
  if (!candidates.length) return { ok: true, topics: [], note: '今日无值得精筛的内容' };

  const scored = [];
  const limit = 50;
  for (let i = 0; i < Math.min(candidates.length, limit); i++) {
    const t = candidates[i];
    const ck = keyFor(t);
    const hit = await cache.get(ck, todayStr);
    if (hit) { scored.push({ ...t, ...hit }); continue; }
    try {
      const s = await scoreOne({ text: t.text, focus }, { apiKey, model: model || 'glm-4-flash' });
      await cache.set(ck, s, todayStr);
      scored.push({ ...t, ...s });
    } catch (e) {
      scored.push({ ...t, score: 0, reason: 'AI 评分失败', tags: [] }); // 降级
    }
  }
  scored.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { ok: true, topics: scored };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'clip') {
    // 本地服务 fallback(File System Access 优先在 content.js 落地;此处保留兜底)
    fetch(SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg.content, filename: msg.filename })
    })
      .then(r => r.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'fetchArticle') {
    fetchArticleViaTab(msg.url)
      .then(html => {
        if (html && html.length > 100) sendResponse({ ok: true, html });
        else sendResponse({ ok: false, error: `页面内容过短(${(html || '').length}bytes)` });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'scanToday') {
    handleScanToday(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
```

> 以上 `resolveShortUrl`/`fetchArticleViaTab`/`clip`/`fetchArticle` 均为完整实现(从现有 v5.5 迁移),无需再补;`scanToday` 为新增编排。

- [ ] **Step 2: 手动验证(浏览器加载扩展后)**

在 `chrome://extensions/` 重新加载扩展,打开知识星球页面,F12 → 扩展 service worker 控制台,确认 `[剪藏] background.js v6 loaded` 无报错(ESM import 成功)。现有单篇剪藏按钮仍可用。

- [ ] **Step 3: Commit**

```bash
git -C /Users/byron/zsxq-clipper add background.js
git -C /Users/byron/zsxq-clipper commit -m "feat: background 改 ESM,加 scanToday 评分编排"
```

---

## Task 9: 设置页 options(填 key/关注领域)

**Files:**
- Create: `options.html`
- Create: `options.js`

- [ ] **Step 1: 创建 options.html**

```html
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>知识星球剪藏 - 设置</title>
<style>body{font-family:-apple-system,sans-serif;max-width:520px;padding:20px}
label{display:block;margin:12px 0 4px}input,textarea{width:100%;padding:6px;box-sizing:border-box}
button{margin-top:16px;padding:8px 16px;background:#4ecca3;border:0;border-radius:6px;cursor:pointer}
#msg{color:#059669;margin-top:8px}</style></head>
<body>
<h2>设置</h2>
<label>智谱 GLM API Key<input id="apiKey" type="password" placeholder="智谱开放平台的 key"></label>
<label>模型(默认 glm-4-flash)<input id="model" placeholder="glm-4-flash"></label>
<label>我关注的领域(一段话,作为评分参考)<textarea id="focus" rows="3" placeholder="AI 编程、独立开发、RAG..."></textarea></label>
<button id="save">保存</button>
<div id="msg"></div>
<script src="options.js"></script>
</body></html>
```

- [ ] **Step 2: 创建 options.js**

```javascript
const $ = id => document.getElementById(id);
chrome.storage.local.get(['apiKey', 'model', 'focus'], r => {
  $('apiKey').value = r.apiKey || '';
  $('model').value = r.model || 'glm-4-flash';
  $('focus').value = r.focus || '';
});
$('save').addEventListener('click', () => {
  chrome.storage.local.set({ apiKey: $('apiKey').value.trim(), model: $('model').value.trim() || 'glm-4-flash', focus: $('focus').value.trim() });
  $('msg').textContent = '✓ 已保存';
});
```

- [ ] **Step 3: 手动验证**

Task 12 加 options_page 后,扩展管理页点「详情/扩展选项」,能打开设置页、保存、刷新后值还在(F12 → Application → chrome.storage.local)。

- [ ] **Step 4: Commit**

```bash
git -C /Users/byron/zsxq-clipper add options.html options.js
git -C /Users/byron/zsxq-clipper commit -m "feat: 设置页(API key/模型/关注领域)"
```

---

## Task 10: content.js 精选栏 UI + 扫描触发

**Files:**
- Modify: `content.js`(追加精选栏注入逻辑,不破坏现有剪藏按钮)

- [ ] **Step 1: 在 content.js IIFE 内追加精选栏代码**

在现有 `(function(){ ... })();` 末尾(`console.log('[剪藏] v5.6...')` 之前)插入:

```javascript
  // ===== 精选栏 =====
  function getGroupId() {
    const m = location.pathname.match(/group[s]?\/(\d+)/) || location.href.match(/group[s]?\/(\d+)/);
    return m ? m[1] : null;
  }

  function injectSidebar() {
    if (document.getElementById('zsxq-curation-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'zsxq-curation-bar';
    bar.style.cssText = 'position:fixed;right:0;top:60px;width:320px;height:80vh;overflow-y:auto;background:#1a1a2e;color:#eee;z-index:99999;border-left:2px solid #4ecca3;padding:10px;font-size:13px;box-shadow:-2px 0 8px rgba(0,0,0,.3)';
    bar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>⭐ AI 精选</b><button id="zsxq-scan-btn" style="background:#4ecca3;border:0;border-radius:4px;padding:3px 8px;cursor:pointer">🔍 扫描今日</button>
      </div>
      <div id="zsxq-curation-list"><div style="color:#8b8baf">点「扫描今日」开始</div></div>`;
    document.body.appendChild(bar);
    document.getElementById('zsxq-scan-btn').addEventListener('click', scanToday);
  }

  async function scanToday() {
    const groupId = getGroupId();
    const list = document.getElementById('zsxq-curation-list');
    if (!groupId) { list.innerHTML = '<div style="color:#ff6b6b">未识别到星球 ID</div>'; return; }
    list.innerHTML = '<div style="color:#ffc93c">⏳ 扫描评分中...</div>';
    const todayStr = new Date().toDateString();
    chrome.runtime.sendMessage({ type: 'scanToday', groupId, todayStr }, resp => {
      if (!resp || !resp.ok) { list.innerHTML = '<div style="color:#ff6b6b">❌ ' + (resp?.error || '失败') + '</div>'; return; }
      if (!resp.topics.length) { list.innerHTML = '<div>' + (resp.note || '今日无内容') + '</div>'; return; }
      list.innerHTML = resp.topics.map(t => `
        <div style="background:#222244;border-radius:6px;padding:8px;margin-bottom:6px">
          <div>⭐${t.score || 0} <b>${escHtml(t.title)}</b></div>
          <div style="color:#8b8baf;font-size:11px">${escHtml(t.author)} · ❤️${t.likes} · 💬${t.comments}</div>
          <div style="color:#aaa;font-size:11px;margin:3px 0">${escHtml(t.reason || '')}</div>
          <button class="zsxq-cur-save" data-id="${t.topic_id}" style="font-size:11px;padding:2px 6px">📋 收</button>
        </div>`).join('');
      list.querySelectorAll('.zsxq-cur-save').forEach(b =>
        b.addEventListener('click', () => saveFromCur(b.dataset.id, resp.topics)));
    });
  }

  function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // 精选栏 [收]:定位该 topic 的 DOM 节点触发现有剪藏,或直接走 File System Access(见 Task 11)
  function saveFromCur(topicId, topics) { /* Task 11/13 接线 */ }

  injectSidebar();
```

- [ ] **Step 2: 手动验证**

重新加载扩展,打开知识星球星球页,右侧出现「⭐ AI 精选」栏 + 「🔍 扫描今日」按钮(未填 key 时点扫描会报"未设置 API key")。

- [ ] **Step 3: Commit**

```bash
git -C /Users/byron/zsxq-clipper add content.js
git -C /Users/byron/zsxq-clipper commit -m "feat: content 注入 AI 精选栏 + 扫描触发"
```

---

## Task 11: File System Access 落盘(改造 saveToServer)

**Files:**
- Modify: `content.js`

- [ ] **Step 1: 在 content.js 加 File System Access 模块**

```javascript
  // ===== File System Access 落盘 =====
  const FS_DB = 'zsxq-clipper-fs';
  const FS_STORE = 'dirs';
  let dirHandle = null;

  async function getClipDir() {
    if (dirHandle) return dirHandle;
    // 从 IndexedDB 恢复已授权句柄
    dirHandle = await idbGet(FS_STORE, 'clips');
    if (dirHandle) {
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return dirHandle;
      const req = await dirHandle.requestPermission({ mode: 'readwrite' }); // 需用户手势
      if (req === 'granted') return dirHandle;
    }
    throw new Error('未授权目录');
  }

  async function authorizeDir() {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet(FS_STORE, 'clips', dirHandle);
    return dirHandle;
  }

  async function saveMarkdownLocal(filename, content) {
    const dir = await getClipDir();
    const fh = await dir.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    return dir.name + '/' + filename;
  }

  // IndexedDB 句柄存取(极简)
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(FS_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(FS_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(store, key) { const db = await idbOpen(); return new Promise((res,rej)=>{const t=db.transaction(store).objectStore(store).get(key);t.onsuccess=()=>res(t.result);t.onerror=()=>rej(t.error);}); }
  async function idbSet(store, key, val) { const db = await idbOpen(); return new Promise((res,rej)=>{const t=db.transaction(store,'readwrite').objectStore(store).put(val,key);t.onsuccess=()=>res();t.onerror=()=>rej(t.error);}); }
```

- [ ] **Step 2: 改造现有单篇剪藏的保存步骤**

把现有 `addClipButton` click handler 里最后的 `saveToServer(md, filename)` 替换为优先 File System Access:

```javascript
        btn.textContent = '⏳ 保存中...';
        let savedPath;
        try {
          savedPath = await saveMarkdownLocal(filename, md); // File System Access
        } catch (e) {
          if (e.message === '未授权目录') {
            btn.textContent = '📋 请先授权目录';
            setTimeout(() => authorizeDir().then(() => alert('已授权 ~/zsxq-clips,请重新点剪藏')), 100);
            return;
          }
          throw e;
        }
        console.log('[剪藏] 已保存到本地:', savedPath);
        btn.textContent = '✅ 已保存';
```

**Step 2b: 图片本地化改走 File System Access**

先在 Step 1 的 File System Access 模块里追加 `saveImageLocal`(递归创建 `assets/<folder>/`):

```javascript
  async function saveImageLocal(folder, hash, blob) {
    const dir = await getClipDir();
    const assetsDir = await dir.getDirectoryHandle('assets', { create: true });
    const subDir = await assetsDir.getDirectoryHandle(folder, { create: true });
    const ext = (blob.type.split('/')[1] || 'jpeg').replace('svg+xml', 'svg');
    const fh = await subDir.getFileHandle(`${hash}.${ext}`, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return `assets/${folder}/${hash}.${ext}`;
  }
```

再把现有图片下载循环(content.js 现状:fetch→blob→base64→POST `IMG_SERVER`)替换为直接写盘。找到现有这段并整体替换:

现有代码(删除):
```javascript
          for (let i = 0; i < collectedImages.length; i++) {
            const imgUrl = collectedImages[i];
            try {
              btn.textContent = `⏳ 下载图片 ${i + 1}/${collectedImages.length}`;
              const resp = await fetch(imgUrl);
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const blob = await resp.blob();
              const mime = blob.type || 'image/jpeg';
              const b64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(blob);
              });
              const saveResp = await fetch(IMG_SERVER, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: assetFolder, urlHash: hashUrl(imgUrl), data: b64, mime })
              });
              const saveData = await saveResp.json();
              if (saveData.ok) { urlToLocal[imgUrl] = saveData.path; }
            } catch (imgErr) {
              console.warn('[剪藏] 图片下载失败:', imgUrl, imgErr.message);
            }
          }
```

替换为:
```javascript
          for (let i = 0; i < collectedImages.length; i++) {
            const imgUrl = collectedImages[i];
            try {
              btn.textContent = `⏳ 下载图片 ${i + 1}/${collectedImages.length}`;
              const resp = await fetch(imgUrl);
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const blob = await resp.blob();
              urlToLocal[imgUrl] = await saveImageLocal(assetFolder, hashUrl(imgUrl), blob);
            } catch (imgErr) {
              console.warn('[剪藏] 图片下载失败:', imgUrl, imgErr.message);
            }
          }
```

`urlToLocal[imgUrl]` 现在是 `assets/<folder>/<hash>.<ext>` 相对路径,下方已有的 `md.replace(url, localPath)` 逻辑无需改动即可把图片链接换成相对路径。

- [ ] **Step 3: 手动验证**

授权流程:首次点剪藏 → 提示授权 → 选 `~/zsxq-clips/` → 重试点剪藏 → 文件落到 `~/zsxq-clips/`。重启浏览器后第一次剪藏需再点"允许"。

- [ ] **Step 4: Commit**

```bash
git -C /Users/byron/zsxq-clipper add content.js
git -C /Users/byron/zsxq-clipper commit -m "feat: File System Access 落盘,取代本地 server"
```

---

## Task 12: manifest 配置更新

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: 更新 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "知识星球剪藏",
  "version": "6.0.0",
  "description": "AI 精选筛选 + 剪藏为 Markdown(支持外链正文抓取、本地落盘)",
  "permissions": ["tabs", "scripting", "storage", "downloads"],
  "host_permissions": ["*://*.zsxq.com/*"],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
  "action": { "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" } },
  "options_page": "options.html",
  "content_scripts": [
    { "matches": ["*://wx.zsxq.com/*"], "js": ["content.js"], "run_at": "document_idle" }
  ],
  "background": { "service_worker": "background.js", "type": "module" }
}
```

变更:`permissions` 加 `storage`/`downloads`;`background` 加 `type:module`;加 `options_page`;version → 6.0.0。

- [ ] **Step 2: 手动验证**

重新加载扩展无报错;设置页可打开;service worker 以 ESM 加载。

- [ ] **Step 3: Commit**

```bash
git -C /Users/byron/zsxq-clipper add manifest.json
git -C /Users/byron/zsxq-clipper commit -m "feat: manifest 加 storage/downloads/ESM/options_page"
```

---

## Task 13: 精选栏 [收] 接线 + 完整流程串联

**Files:**
- Modify: `content.js`(实现 Task 10 留空的 `saveFromCur`)

- [ ] **Step 1: 实现 saveFromCur**

精选栏的 `[收]` 需要从评分结果直接保存(已有完整 text/images,无需重新抓 DOM):

```javascript
  async function saveFromCur(topicId, topics) {
    const t = topics.find(x => x.topic_id === topicId);
    if (!t) return;
    const md = `# ${t.title}\n\n- **作者**: ${t.author}\n- **AI评分**: ${t.score}\n- **理由**: ${t.reason}\n\n---\n\n${t.text}\n`;
    const safe = (t.title || 'post').substring(0,30).replace(/[\\/:*?"<>|\n]/g,'_');
    const ts = new Date().toISOString().replace(/[:.]/g,'-').substring(0,19);
    try {
      const p = await saveMarkdownLocal(`zsxq_${safe}_${ts}.md`, md);
      alert('✓ 已保存到 ' + p);
    } catch (e) {
      if (e.message === '未授权目录') { await authorizeDir(); }
      else alert('保存失败: ' + e.message);
    }
  }
```

- [ ] **Step 2: 端到端手动验证(完整流程)**

填好 API key + 关注领域 → 打开星球 → 点「🔍 扫描今日」→ 精选栏出现评分列表 → 点某条 `[收]` → 文件落到 `~/zsxq-clips/` → 确认内容正确、可衔接 wiki 入库。

- [ ] **Step 3: Commit**

```bash
git -C /Users/byron/zsxq-clipper add content.js
git -C /Users/byron/zsxq-clipper commit -m "feat: 精选栏[收]接线,完整流程串联"
```

---

## Task 14: 评分质量回归测试(已入库正样本)

**Files:**
- Create: `tests/regression.test.mjs`

- [ ] **Step 1: 写回归测试**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOne } from '../lib/ai-scorer.mjs';
import { readArchiveSamples } from './helpers.mjs'; // 读取 ~/zsxq-clips/.archived 已入库帖

test('已入库帖子应得较高分(>=6)', async () => {
  const samples = readArchiveSamples(); // [{text}, ...]
  for (const s of samples) {
    const r = await scoreOne({ text: s.text, focus: '' }, { apiKey: process.env.GLM_KEY, model: 'glm-4-flash' });
    assert.ok(r.score >= 6, `正样本得分过低:${r.score} - ${s.text.slice(0, 30)}`);
  }
});
```

Create `tests/helpers.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';
export function readArchiveSamples() {
  const dir = path.join(process.env.HOME, 'zsxq-clips', '.archived');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).slice(0, 5).map(f => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    return { text: raw.replace(/^---[\s\S]*?---/, '').slice(0, 1000) }; // 去 frontmatter
  });
}
```

- [ ] **Step 2: 运行(需真实 key)**

Run: `cd /Users/byron/zsxq-clipper && GLM_KEY=<你的key> node --test tests/regression.test.mjs`
Expected: 正样本得分均 ≥ 6(若偏低,调 prompt 或阈值)

- [ ] **Step 3: Commit**

```bash
git -C /Users/byron/zsxq-clipper add tests/regression.test.mjs tests/helpers.mjs
git -C /Users/byron/zsxq-clipper commit -m "test: 已入库帖子作正样本的评分回归"
```

---

## Task 15: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README,增加「AI 精选」章节**

在现有 README 加一节,说明:填 API key/关注领域(扩展选项)、打开星球点「🔍 扫描今日」、首次剪藏授权 `~/zsxq-clips/` 目录、重启后首写需点允许。注明"本地 server 现为可选"。

- [ ] **Step 2: Commit**

```bash
git -C /Users/byron/zsxq-clipper add README.md
git -C /Users/byron/zsxq-clipper commit -m "docs: README 增加 AI 精选用法"
```

---

## 依赖关系

- Task 1(API 实测)→ 必须先做,Task 7/8 的字段以它为准
- Task 2(测试基建)→ Task 3-7 单测的前置
- Task 3→4(scorer→filter 依赖)
- Task 3-7(纯逻辑)可并行写
- Task 8(编排)依赖 3-7
- Task 9/10/11 相对独立,Task 13 串联它们
- Task 12 可在 8 之后任何时候
- Task 14 在评分链(5/8)就绪后
- Task 15 最后
