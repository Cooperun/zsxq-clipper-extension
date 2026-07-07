# 知识星球 AI 精选 — 精炼迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已上线的 AI 精选基础上:① 全文悬浮框放大 + Markdown 渲染;② 评分纳入评论;③ 三维度评分(新鲜度/重复/实用,本地算+AI 评加权)。

**Architecture:** 纯逻辑(`computeFreshness`/`computeNovelty`/`computeTotalScore`/`fetchComments`)抽到 `lib/`,TDD 单测;`background.js` 编排三维度(本地 freshness/novelty + AI utility + 合成);`content.js` 负责读 `~/zsxq-clips/.archived` 历史、全文放大 + mdToHtml 渲染、卡片 F/N/U 标签。

**Tech Stack:** Chrome MV3、ES modules、File System Access、智谱/DeepSeek(OpenAI 兼容)、`node:test`。

**Spec:** `docs/superpowers/specs/2026-07-06-zsxq-curation-refinement-design.md`
**API 参考:** `docs/api-reference.md`(Task 1 补 comments 段)

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `docs/api-reference.md` | 补 comments 端点实测 | Modify |
| `lib/scorer.mjs` | + `computeFreshness` / `computeNovelty` / `computeTotalScore` | Modify |
| `tests/scorer.test.mjs` | + 三函数单测 | Modify |
| `lib/zsxq-api.mjs` | + `fetchComments` / `mapComment` | Modify |
| `tests/zsxq-api.test.mjs` | + fetchComments 测试 | Modify |
| `background.js` | handleScanToday 编排三维度 + 评论 | Modify |
| `content.js` | 读 .archived history + 全文放大 mdToHtml + F/N/U 标签 | Modify |

---

## Task 1: 实测评论 API,补充 api-reference.md

**Files:** Modify `docs/api-reference.md`

- [ ] **Step 1:** 在登录态星球页(Chrome DevTools console 或 chrome-devtools-mcp)执行:
```javascript
fetch('https://api.zsxq.com/v2/groups/<group_id>/topics/<topic_id>/comments?count=5', {credentials:'include'}).then(r=>r.json()).then(d=>console.log(JSON.stringify({suc:d.succeeded,code:d.code,err:d.error,keys:Object.keys(d),rdKeys:Object.keys(d.resp_data||{}),n:d.resp_data?.comments?.length,c0keys:d.resp_data?.comments?.[0]&&Object.keys(d.resp_data.comments[0]),c0sample:d.resp_data?.comments?.[0]&&JSON.stringify(d.resp_data.comments[0]).slice(0,500)})))
```
- [ ] **Step 2:** 把结果(端点 URL、认证、`resp_data.comments[]` 字段:文本/作者/点赞/时间)追加到 `docs/api-reference.md` 新增的「9. 评论 API」段。若字段与下方 Task 5 的 `mapComment` 推测不同(`text`/`owner.name`/`likes_count`),以实测为准,先改 Task 5 的 `mapComment`。
- [ ] **Step 3:** Commit
```bash
git -C /Users/byron/zsxq-clipper add docs/api-reference.md
git -C /Users/byron/zsxq-clipper commit -m "docs: 实测评论 API 参考"
```

---

## Task 2: computeFreshness + computeTotalScore(TDD)

**Files:** Modify `lib/scorer.mjs`、`tests/scorer.test.mjs`

- [ ] **Step 1:** 在 `tests/scorer.test.mjs` 末尾加失败测试:
```javascript
import { computeFreshness, computeTotalScore } from '../lib/scorer.mjs';

test('computeFreshness: 今天=1,15天≈0.5,30天=0,>30天=0', () => {
  const now = new Date('2026-07-06T12:00:00+0800').getTime();
  assert.equal(computeFreshness('2026-07-06T12:00:00+0800', now), 1);
  assert.ok(Math.abs(computeFreshness('2026-06-21T12:00:00+0800', now) - 0.5) < 0.05);
  assert.equal(computeFreshness('2026-06-06T12:00:00+0800', now), 0);
  assert.equal(computeFreshness('2025-01-01T00:00:00+0800', now), 0);
  assert.equal(computeFreshness('', now), 0);
});

test('computeTotalScore: 三维度加权 → 1-10', () => {
  // freshness=1, novelty=1, utility=10 → (0.2+0.3+0.5)*10=10
  assert.equal(computeTotalScore({ freshness: 1, novelty: 1, utility: 10 }), 10);
  // freshness=0, novelty=0, utility=0 → 0 → clamp 1
  assert.equal(computeTotalScore({ freshness: 0, novelty: 0, utility: 0 }), 1);
  // freshness=0.5, novelty=0.5, utility=5 → (0.1+0.15+0.25)*10=5
  assert.equal(computeTotalScore({ freshness: 0.5, novelty: 0.5, utility: 5 }), 5);
});
```
(注意:`import` 在 `node:test` 的 .mjs 里重复 import 同一模块是合法的,但为避免与文件顶已有 `import { computeQuality, infoDensity }` 重复,可合并到顶部的 import 语句里。)

- [ ] **Step 2:** 运行确认失败:`cd /Users/byron/zsxq-clipper && /Users/byron/.hermes/node/bin/node --test tests/scorer.test.mjs` → FAIL(函数未导出)
- [ ] **Step 3:** 在 `lib/scorer.mjs` 末尾追加:
```javascript
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
```
- [ ] **Step 4:** 运行确认通过(2 新测试 + 原 3 = 5 PASS)
- [ ] **Step 5:** Commit `feat: scorer 加 freshness/totalScore`

---

## Task 3: computeNovelty(与历史帖相似度,TDD)

**Files:** Modify `lib/scorer.mjs`、`tests/scorer.test.mjs`

- [ ] **Step 1:** 加失败测试:
```javascript
import { computeNovelty } from '../lib/scorer.mjs';

test('computeNovelty: history 空 → 1(不惩罚)', () => {
  assert.equal(computeNovelty({ title: 'x', text: 'y' }, []), 1);
  assert.equal(computeNovelty({ title: 'x', text: 'y' }, null), 1);
});

test('computeNovelty: 与历史帖标题全相同 → 低(接近 0)', () => {
  const history = [{ title: 'AI 编程实战', textPrefix: '今天聊 AI' }];
  const dup = { title: 'AI 编程实战', text: '今天聊 AI 的具体做法' };
  assert.ok(computeNovelty(dup, history) < 0.3, '重复帖 novelty 应 <0.3');
});

test('computeNovelty: 与历史完全不同 → 接近 1', () => {
  const history = [{ title: 'abc', textPrefix: 'xyz' }];
  const fresh = { title: '完全不同的新话题', text: '全新的内容讨论' };
  assert.ok(computeNovelty(fresh, history) > 0.7, '新帖 novelty 应 >0.7');
});
```
- [ ] **Step 2:** 运行确认失败
- [ ] **Step 3:** 在 `lib/scorer.mjs` 追加(字符 bigram + Jaccard,中文友好):
```javascript
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
```
- [ ] **Step 4:** 运行确认通过(3 新 + 之前 = 8 PASS)
- [ ] **Step 5:** Commit `feat: scorer 加 novelty(与历史帖相似度)`

---

## Task 4: fetchComments + 大整数 ID 精度修正(TDD)

**Files:** Modify `lib/zsxq-api.mjs`、`tests/zsxq-api.test.mjs`

> 实测要点(见 `docs/api-reference.md` §9/§10):
> 1. 评论端点是 **`/v2/topics/<topic_id>/comments`**(**不带 group**);`/groups/<gid>/topics/<tid>/comments` 实测 404。
> 2. `topic_id`/`comment_id`/`user_id` 是 int64 超 2^53,`resp.json()` 会**截断**末位 → 报 15403「主题已经被删除」。必须先正则转字符串再 parse。
> 3. comment 字段实测确认:`text`、`owner.name`、`likes_count`、`create_time`、`rewards_count`、`replies_count` 等(`mapComment` 推测正确)。

- [ ] **Step 1:** 加 `parseZsxqJson` 工具函数,改 `fetchToday` 用它(修 topic_id 精度,fetchComments 依赖)。在 `lib/zsxq-api.mjs` 顶部 `const BASE = '...';` 之后插入:
```javascript
// zsxq 的 topic_id/comment_id/user_id 是 int64、超 2^53,resp.json() 会截断末位。
// 先把这些 ID 字段加引号转字符串再 parse(正则只匹配 JSON 键值结构,不误伤字符串内容里的字面量)。
function parseZsxqJson(text) {
  const safe = text.replace(/"(topic_id|topic_uid|comment_id|user_id)"\s*:\s*(\d+)/g, '"$1":"$2"');
  return JSON.parse(safe);
}
```
然后把 `fetchToday` 里的 `const data = await resp.json();` 改成:
```javascript
    const data = parseZsxqJson(await resp.text());
```

- [ ] **Step 2:** 更新现有 `fetchToday` 测试(mock 改用 `text`,并验证大整数 topic_id 精度保留)。把 `tests/zsxq-api.test.mjs` 里那个 `fetchToday` 测试整段替换为:
```javascript
test('fetchToday: mock fetch 单页返回(scope=all,credentials include,大整数 id 精度保留)', async () => {
  const page = { succeeded: true, code: 0, resp_data: { topics: [
    { topic_id: 45544248881118548, create_time: '2026-06-16T23:54:57.185+0800', likes_count: 5, comments_count: 0, digested: false, talk: { text: 'a'.repeat(120), owner: { name: 'x' } } }
  ] } };
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { text: async () => JSON.stringify(page) }; };
  const topics = await fetchToday({ groupId: 'g1', fetch: fakeFetch, isBeforeToday: () => false });
  assert.equal(topics.length, 1);
  assert.equal(topics[0].topic_id, '45544248881118548'); // 关键:大整数末位未被截断
  assert.ok(calls[0].url.includes('/v2/groups/g1/topics'));
  assert.ok(calls[0].url.includes('scope=all'));
  assert.equal(calls[0].opts.credentials, 'include'); // 认证靠 cookie
});
```
> 验证点:`page.topic_id` 写成 number,`JSON.stringify` 输出 `"topic_id":45544248881118548`,`parseZsxqJson` 正则转成 `"topic_id":"45544248881118548"` —— 最终字符串末位精确。若用旧 `resp.json()`,会得到 `'45544248881118540'`(末位被截),断言失败。

- [ ] **Step 3:** 运行 `node --test tests/zsxq-api.test.mjs`,确认 fetchToday 测试通过(精度修正生效)。

- [ ] **Step 4:** 加 `mapComment` + `fetchComments` 失败测试(文件顶部 import 加 `fetchComments, mapComment`):
```javascript
import { mapTopic, fetchToday, fetchComments, mapComment } from '../lib/zsxq-api.mjs';

test('mapComment: 字段映射(实测字段)', () => {
  const c = mapComment({ text: '好帖', owner: { name: '张三', user_id: 123 }, likes_count: 5 });
  assert.deepEqual(c, { text: '好帖', owner: '张三', likes: 5 });
});

test('fetchComments: URL 不带 group + cookie + 按 likes 降序', async () => {
  const page = { succeeded: true, resp_data: { comments: [
    { comment_id: 1, text: '评论A', owner: { name: 'a' }, likes_count: 2 },
    { comment_id: 2, text: '评论B', owner: { name: 'b' }, likes_count: 10 }
  ] } };
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { text: async () => JSON.stringify(page) } };
  const cs = await fetchComments({ topicId: '45544248881118548', fetch: fakeFetch });
  assert.ok(calls[0].url.includes('/v2/topics/45544248881118548/comments'), 'URL 应不带 group: ' + calls[0].url);
  assert.ok(!calls[0].url.includes('/groups/'), '不应含 /groups/: ' + calls[0].url);
  assert.equal(calls[0].opts.credentials, 'include');
  assert.equal(cs.length, 2);
  assert.equal(cs[0].likes, 10); // 降序
});
```

- [ ] **Step 5:** 运行确认失败(`fetchComments`/`mapComment` 未导出)。

- [ ] **Step 6:** 在 `lib/zsxq-api.mjs` 末尾追加(`BASE`、`parseZsxqJson` 已存在):
```javascript
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
  const resp = await f(url, { credentials: 'include' });
  const data = parseZsxqJson(await resp.text());
  if (!data.succeeded) throw new Error('zsxq comments API 错误: ' + (data.error || data.code));
  const comments = (data?.resp_data?.comments || []).map(mapComment);
  comments.sort((a, b) => b.likes - a.likes);
  return comments;
}
```

- [ ] **Step 7:** 运行全量 `npm test` 确认通过。
- [ ] **Step 8:** Commit `feat: zsxq-api fetchComments(端点不带 group)+ 修大整数 ID 精度`

---

## Task 5: background 三维度编排 + 评论拼入

**Files:** Modify `background.js`

- [ ] **Step 1:** 顶部 import 加 `computeFreshness`、`computeNovelty`、`computeTotalScore`(from scorer)、`fetchComments`(from zsxq-api):
```javascript
import { coarseFilter } from './lib/filter.mjs';
import { scoreOne } from './lib/ai-scorer.mjs';
import { makeCache, keyFor } from './lib/cache.mjs';
import { fetchToday, fetchComments } from './lib/zsxq-api.mjs';
import { computeFreshness, computeNovelty, computeTotalScore } from './lib/scorer.mjs';
```
- [ ] **Step 2:** `handleScanToday` 签名加 `history`,评分循环改成三维度。找到现有循环(从 `for (let i = 0; i < Math.min(candidates.length, limit); i++) {` 到 `scored.sort(...)` 整段),替换为:
```javascript
async function handleScanToday({ groupId, todayStr, sinceDays = 1, history = [] }) {
  const { apiKey, focus, model, provider, endpoint } = await chrome.storage.local.get(['apiKey', 'focus', 'model', 'provider', 'endpoint']);
  if (!apiKey) return { ok: false, error: '未设置 API key,请点 ⚙️ 填写' };

  const sinceTs = Date.now() - sinceDays * 86400000;
  const isBeforeRange = (ts) => new Date(ts).getTime() < sinceTs;
  let topics;
  try {
    topics = await fetchToday({ groupId, isBeforeToday: isBeforeRange });
  } catch (e) { return { ok: false, error: '拉取星球失败(登录态?):' + e.message }; }

  const candidates = coarseFilter(topics);
  if (!candidates.length) return { ok: true, topics: [], note: '该时间段无值得精筛的内容' };

  const scored = [];
  const limit = 50;
  for (let i = 0; i < Math.min(candidates.length, limit); i++) {
    const t = candidates[i];
    const ck = keyFor(t);
    const hit = await cache.get(ck, todayStr);
    let utility;
    if (hit && typeof hit.utility === 'number') {
      // 命中缓存:utility 复用,跳过评论拉取(评论只为 AI 评分服务,不缓存)
      utility = hit;
    } else {
      // 未命中:拉评论 → 拼 textForAI → AI 评 utility
      let comments = [];
      try { comments = await fetchComments({ topicId: t.topic_id }); }
      catch (e) { /* 降级:无评论 */ }
      const topComments = comments.slice(0, 3)
        .map(c => `- ${c.text.replace(/\n/g, ' ').slice(0, 200)}(赞${c.likes})`).join('\n');
      const textForAI = topComments ? `${t.text}\n\n精选评论:\n${topComments}` : t.text;
      try {
        const s = await scoreOne({ text: textForAI, focus }, { apiKey, model, provider, endpoint });
        utility = { utility: s.score, reason: s.reason, tags: s.tags };
        await cache.set(ck, utility, todayStr);
      } catch (e) {
        utility = { utility: 0, reason: 'AI 评分失败', tags: [] };
      }
    }
    // freshness / novelty 本地算(每次现算,不缓存 —— 随时间/历史变化)
    const freshness = computeFreshness(t.create_time);
    const novelty = computeNovelty(t, history);
    const total = computeTotalScore({ freshness, novelty, utility: utility.utility });
    scored.push({
      ...t, ...utility,
      score: total,
      freshness: Math.round(freshness * 10) / 10,
      novelty: Math.round(novelty * 10) / 10
    });
  }
  scored.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { ok: true, topics: scored };
}
```
> 注意:`hit` 缓存结构改为存 `{utility, reason, tags}`(utility 复用,不缓存 freshness/novelty —— 它们本地算,每次现算)。`scored.push` 用 `...utility`(展开 utility/reason/tags)+ score/freshness/novelty。
- [ ] **Step 3:** `node --check background.js` 通过
- [ ] **Step 4:** Commit `feat: background 三维度评分 + 评论纳入`

---

## Task 6: content.js 读 .archived history + 传 background

**Files:** Modify `content.js`

- [ ] **Step 1:** 在 File System Access 模块区(`saveImageLocal` 后)加:
```javascript
  // 读 ~/zsxq-clips/.archived/*.md 作为历史,支撑 novelty(与已入库帖比对)
  async function buildHistory() {
    try {
      const dir = await getClipDir(); // 可能抛"未授权目录"
      const archDir = await dir.getDirectoryHandle('.archived');
      const names = [];
      for await (const [name, handle] of archDir.entries()) {
        if (handle.kind === 'file' && name.endsWith('.md')) names.push(name);
      }
      const history = [];
      for (const name of names.slice(0, 60)) {
        try {
          const fh = await archDir.getFileHandle(name);
          const f = await fh.getFile();
          const raw = await f.text();
          const body = raw.replace(/^---[\s\S]*?---/, '').replace(/\n+/g, ' ').slice(0, 200);
          const title = name.replace(/^\d{4}-\d{2}-\d{2}_zsxq_/, '').replace(/_?\d{4}-\d{2}-\d{2}T.*$/, '').replace(/\.md$/, '').slice(0, 60);
          history.push({ title, textPrefix: body });
        } catch (e) { /* 跳过单文件错误 */ }
      }
      return history;
    } catch (e) {
      return []; // 句柄未授权 / 无 .archived → 空,novelty 降级 1
    }
  }
```
- [ ] **Step 2:** `scanToday` 改成发消息前先 `const history = await buildHistory();`,消息体加 `history`:
```javascript
  async function scanToday() {
    const groupId = getGroupId();
    const list = document.getElementById('zsxq-curation-list');
    if (!list) return;
    if (!groupId) { list.innerHTML = '<div style="color:#ff6b6b">未识别到星球 ID</div>'; return; }
    const rangeSel = document.getElementById('zsxq-range');
    const sinceDays = parseInt(rangeSel?.value || '7', 10);
    list.innerHTML = `<div style="color:#ffc93c">⏳ 扫描近 ${sinceDays} 天,评分中(拉取+评论+AI,稍候)...</div>`;
    const todayStr = new Date().toDateString();
    const history = await buildHistory();
    chrome.runtime.sendMessage({ type: 'scanToday', groupId, todayStr, sinceDays, history }, resp => {
      // ...(resp 处理与渲染保持不变)
    });
  }
```
- [ ] **Step 3:** `node --check content.js` 通过
- [ ] **Step 4:** Commit `feat: content 读 .archived 历史传 background 算 novelty`

---

## Task 7: content.js 全文放大 + mdToHtml 渲染

**Files:** Modify `content.js`

- [ ] **Step 1:** 在 `escHtml` 后加 `mdToHtml`:
```javascript
  // 轻量 Markdown → HTML(zsxq 正文常见格式)。先 escHtml 防 XSS,再加受控标签。
  function mdToHtml(md) {
    let h = escHtml(md || '');
    // 代码块(多行)
    h = h.replace(/```([\s\S]*?)```/g, (m, c) => `<pre style="background:#000;color:#9fe09f;padding:8px;border-radius:4px;overflow-x:auto;font-size:11px;margin:6px 0">${c.replace(/\n/g,'<br>')}</pre>`);
    // 标题
    h = h.replace(/^### ?(.*)$/gm, '<h4 style="margin:8px 0 4px">$1</h4>')
         .replace(/^## ?(.*)$/gm, '<h3 style="margin:8px 0 4px">$1</h3>')
         .replace(/^# ?(.*)$/gm, '<h2 style="margin:10px 0 4px">$1</h2>');
    // 加粗 / 行内代码
    h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
         .replace(/`([^`]+)`/g, '<code style="background:#000;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>');
    // 图片
    h = h.replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$1" style="max-width:100%;border-radius:6px;margin:6px 0;display:block">');
    // 链接
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#7aa2ff">$1</a>');
    // 引用(escHtml 把 > 转成 &gt;)
    h = h.replace(/^&gt; ?(.*)$/gm, '<blockquote style="border-left:3px solid #4ecca3;padding-left:8px;color:#aaa;margin:6px 0">$1</blockquote>');
    // 无序列表
    h = h.replace(/(?:^|\n)[\-\*] (.*)/g, (m, t) => `\n<li style="margin-left:16px;list-style:disc">${t}</li>`);
    h = h.replace(/(<li[^>]*>[\s\S]*?<\/li>)/g, '<ul style="margin:4px 0;padding-left:8px">$1</ul>');
    // 换行
    h = h.replace(/\n/g, '<br>');
    return h;
  }
```
- [ ] **Step 2:** 加 `lastCurTopics` + `renderCuration(topics)`(卡片模板含 F/N/U 标签 + 两个按钮 handler)+ `expandReader` + `closeReader`(返回列表时复用 renderCuration 恢复卡片,不留空栏):
```javascript
  let lastCurTopics = null; // 闭包级:closeReader 重建列表时复用,避免返回后空栏

  // 渲染精选卡片列表(scanToday 成功 + closeReader 重建 都调它,DRY)
  function renderCuration(topics) {
    lastCurTopics = topics;
    const list = document.getElementById('zsxq-curation-list');
    if (!list) return;
    if (!topics || !topics.length) { list.innerHTML = '<div>该时间段无内容</div>'; return; }
    list.innerHTML = topics.map((t, i) => {
      const dt = t.create_time ? new Date(t.create_time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
      const imgs = (t.images && t.images.length) ? '<div style="margin-top:4px">' + t.images.map(u => `<a href="${escHtml(u)}" target="_blank" rel="noopener" style="color:#7aa2ff;font-size:11px;margin-right:6px">🖼 图</a>`).join('') + '</div>' : '';
      return `
        <div style="background:#222244;border-radius:6px;padding:8px;margin-bottom:6px">
          <div>⭐${escHtml(t.score)} <b>${escHtml(t.title)}</b></div>
          <div style="color:#8b8baf;font-size:11px">${escHtml(dt)} · ${escHtml(t.author)} · ❤️${escHtml(t.likes)} · 💬${escHtml(t.comments)}</div>
          <div style="color:#aaa;font-size:11px;margin:3px 0">${escHtml(t.reason || '')}</div>
          <div style="color:#9a9aff;font-size:10px;margin:2px 0">F${escHtml(t.freshness)} · N${escHtml(t.novelty)} · U${escHtml(t.utility)}</div>
          <button class="zsxq-cur-save" data-id="${escHtml(t.topic_id)}" style="font-size:11px;padding:2px 8px;background:#4ecca3;border:0;border-radius:3px;cursor:pointer;color:#111">📋 收</button>
          <button class="zsxq-cur-full-btn" data-i="${i}" style="font-size:11px;padding:2px 8px;background:#333;border:0;border-radius:3px;cursor:pointer;color:#eee;margin-left:6px">📄 全文</button>
        </div>`;
    }).join('');
    list.querySelectorAll('.zsxq-cur-save').forEach(b =>
      b.addEventListener('click', () => saveFromCur(b.dataset.id, topics)));
    list.querySelectorAll('.zsxq-cur-full-btn').forEach(b =>
      b.addEventListener('click', () => expandReader(parseInt(b.dataset.i, 10), topics)));
  }

  // 全文阅读视图:悬浮框放大 + md 渲染单帖
  function expandReader(topicIndex, topics) {
    const t = topics[topicIndex];
    if (!t) return;
    const bar = document.getElementById('zsxq-curation-bar');
    if (!bar) return;
    localStorage.setItem('zsxq-cur-expand', String(topicIndex));
    bar.style.width = '640px';
    bar.style.maxHeight = '90vh';
    bar.style.height = '90vh';
    bar.style.left = '50%';
    bar.style.top = '5vh';
    bar.style.transform = 'translateX(-50%)';
    const imgs = (t.images && t.images.length) ? '<div style="margin-top:8px">' + t.images.map(u => `<img src="${escHtml(u)}" style="max-width:100%;border-radius:6px;margin:4px 0;display:block">`).join('') + '</div>' : '';
    bar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:move" id="zsxq-reader-head">
        <b>⭐ ${escHtml(t.score)} · ${escHtml(t.title)}</b>
        <button id="zsxq-reader-close" style="background:#333;border:0;border-radius:4px;padding:4px 10px;cursor:pointer;color:#eee">← 返回列表</button>
      </div>
      <div style="color:#8b8baf;font-size:11px;margin-bottom:8px">${escHtml(t.author)} · ❤️${escHtml(t.likes)} · 💬${escHtml(t.comments)} · F${escHtml(t.freshness)} N${escHtml(t.novelty)} U${escHtml(t.utility)}</div>
      <div style="overflow-y:auto;max-height:72vh;line-height:1.6;font-size:13px">${mdToHtml(t.text)}${imgs}</div>`;
    makeDraggable(bar, document.getElementById('zsxq-reader-head'));
    document.getElementById('zsxq-reader-close').addEventListener('click', () => closeReader());
  }
  function closeReader() {
    localStorage.removeItem('zsxq-cur-expand');
    const bar = document.getElementById('zsxq-curation-bar');
    if (bar) {
      // reader 改了 bar.innerHTML,直接 injectSidebar 会因 #zsxq-curation-bar 仍在而 early-return。
      // 先 remove 旧 bar → injectSidebar 按 loadBarState() 重建空壳(原尺寸/位置)→ renderCuration 恢复卡片
      bar.remove();
      injectSidebar();
      renderCuration(lastCurTopics); // 返回列表时恢复刚才的卡片,不留空栏
    }
  }
```
- [ ] **Step 3:** 重构 scanToday 的 sendMessage 回调 —— 卡片模板 + 两个 handler 已移入 renderCuration(Step 2),回调里只留错误/空分支 + 成功时调 renderCuration。当前 `content.js:742-761` 回调尾部的成功分支是:
```javascript
      list.innerHTML = resp.topics.map((t, i) => { /* 卡片模板 */ }).join('');
      list.querySelectorAll('.zsxq-cur-save').forEach(b =>
        b.addEventListener('click', () => saveFromCur(b.dataset.id, resp.topics)));
      list.querySelectorAll('.zsxq-cur-full-btn').forEach(b =>
        b.addEventListener('click', () => { /* toggle .zsxq-cur-full */ }));
```
整段替换为一行:
```javascript
      renderCuration(resp.topics);
```
(即删除内联 `map` 模板 + 两个 handler 绑定块;错误分支 `chrome.runtime.lastError` / `!resp.ok` / 空 topics 显示 `resp.note` 三处保持原样不动。)
- [ ] **Step 4:** `node --check content.js` 通过
- [ ] **Step 5:** Commit `feat: 全文阅读视图(悬浮框放大 + md 渲染)`

---

## Task 8: 端到端验证

**Files:** 无(手动)

- [ ] **Step 1:** 重载扩展(chrome://extensions → 知识星球剪藏 → 🔄 刷新)
- [ ] **Step 2:** 刷新星球页 → 点 🔍 扫描近 7 天 → 确认:卡片出 F/N/U 标签;总分基于三维度;评分含评论(提问帖的精华评论影响了分数)
- [ ] **Step 3:** 点 📄 全文 → 悬浮框放大到 640px,正文 md 渲染(标题/列表/代码/图片),「← 返回列表」回原
- [ ] **Step 4:** 验证 .archived 比对生效:与某已入库帖高度相似的帖 → novelty 低(F标签 N 值小)
- [ ] **Step 5:** 若全过,无新 commit(纯验证)。若有 bug,定位修复。

---

## 依赖关系

- Task 1(评论 API 实测)→ Task 4 的 `mapComment` 字段以它为准
- Task 2/3(scorer)→ Task 5 编排用
- Task 4(fetchComments)→ Task 5 编排用
- Task 5(background)→ Task 8 端到端
- Task 6/7(content)相对独立;Task 7 的 renderCuration 用 background 返回的 freshness/novelty/utility(Task 5),F/N/U 标签也在 Task 7
- Task 8 端到端最后

## Self-Review 已做
- spec 覆盖:① 全文放大+md 渲染(Task 7)② 评论纳入评分(Task 4/5)③ 三维度评分 + F/N/U 标签(Task 2/3/5 + Task 7 renderCuration)④ .archived 历史读取(Task 6)—— 全覆盖
- closeReader 返回列表时通过 renderCuration(lastCurTopics) 恢复卡片,不留空栏(Task 7)
- 无 placeholder(Task 1 实测评论 API 后再确认字段,其余代码完整)
- 类型一致:`computeFreshness(create_time_iso)`、`computeNovelty(topic,{title,text}) ↔ history[{title,textPrefix}]`、`fetchComments({groupId,topicId})`、background 返回 `freshness/novelty/utility/score` —— 跨 task 一致
