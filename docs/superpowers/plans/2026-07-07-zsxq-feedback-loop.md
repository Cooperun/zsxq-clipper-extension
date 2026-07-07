# 反馈迭代评分 + Token 用量记录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 用户对卡片给反馈(自己打的分+理由)→ (B) 每次评分注入最近5条纠偏作 few-shot;(C) 满20条自动 LLM 重生成 guidance 让旧缓存失效重评;附带轻量 token 7日柱状图。

**Architecture:** 纯逻辑(feedback 存储/token 记录/guidance 生成)抽到 `lib/`,TDD 单测;`background.js` 编排(自动 regen + token 记录 + feedback/guidance 透传 scoreOne);`content.js` 卡片 [✎ 我评] 表单 + 设置面板 token 柱状图。`guidanceVersion` 进 cache key 实现 C 后批量重评。

**Tech Stack:** Chrome MV3、ES modules、`node:test`、智谱/DeepSeek(OpenAI 兼容 `usage`)。

**Spec:** `docs/superpowers/specs/2026-07-07-zsxq-feedback-loop-design.md`

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `lib/feedback.mjs` | 反馈存储 + token 用量记录(纯函数,storage 注入) | Create |
| `tests/feedback.test.mjs` | feedback/token 单测 | Create |
| `lib/ai-scorer.mjs` | buildPrompt 加 feedback/guidance 段;scoreOne 返回 usage;+ buildGuidancePrompt/regenerateGuidance | Modify |
| `tests/ai-scorer.test.mjs` | buildPrompt 含 feedback/guidance;scoreOne 返回 usage | Modify |
| `lib/cache.mjs` | keyFor 加 guidanceVersion | Modify |
| `background.js` | 自动 regen + token 记录 + 透传 + addFeedback handler | Modify |
| `content.js` | 卡片 [✎ 我评] 表单 + 已评标记;设置面板 token 柱状图 | Modify |

> 约定:Bash cwd 每次重置,git/npm 命令用 `cd /Users/byron/zsxq-clipper && ...` 或 `git -C`;node 用 `/Users/byron/.hermes/node/bin/node`;commit 身份 `git -c user.email=Cooperun@users.noreply.github.com -c user.name=Cooperun -c ...`,message 末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## Task 1: lib/feedback.mjs + 测试(TDD)

**Files:** Create `lib/feedback.mjs`、`tests/feedback.test.mjs`

- [ ] **Step 1:** 写失败测试 `tests/feedback.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFeedback, addFeedback, corrections, recordTokens, getTokenUsage } from '../lib/feedback.mjs';

function mockStore() {
  const m = new Map();
  return { get: async k => m.get(k), set: async (k, v) => { m.set(k, v); } };
}

test('addFeedback: 新增 + 同 topic_id 覆盖 + 上限淘汰最旧', async () => {
  const s = mockStore();
  await addFeedback(s, { topic_id: 't1', title: 'A', aiScore: 9, userScore: 5, reason: 'r1', ts: 1 });
  await addFeedback(s, { topic_id: 't2', title: 'B', aiScore: 8, userScore: 7, reason: 'r2', ts: 2 });
  let all = await addFeedback(s, { topic_id: 't1', title: 'A2', aiScore: 9, userScore: 6, reason: 'r1b', ts: 3 });
  assert.equal(all.length, 2);                 // t1 覆盖,不新增
  assert.equal(all.find(x => x.topic_id === 't1').title, 'A2'); // 覆盖为最新
  // 凑满 cap=3,再加一条超限 → 淘汰 ts 最小的(t2, ts=2)
  await addFeedback(s, { topic_id: 't3', title: 'C', aiScore: 7, userScore: 7, reason: 'r3', ts: 4 }, 3);
  await addFeedback(s, { topic_id: 't4', title: 'D', aiScore: 7, userScore: 7, reason: 'r4', ts: 5 }, 3);
  all = await getFeedback(s);
  assert.equal(all.length, 3);
  assert.ok(!all.find(x => x.topic_id === 't2')); // ts 最小的被淘汰
});

test('corrections: 取 |userScore-aiScore|>=2,按 ts 降序取前5', () => {
  const fb = [
    { topic_id: 'a', title: 'a', aiScore: 9, userScore: 9, reason: '', ts: 1 }, // 差0,排除
    { topic_id: 'b', title: 'b', aiScore: 9, userScore: 5, reason: 'rb', ts: 2 }, // 差4,留
    { topic_id: 'c', title: 'c', aiScore: 7, userScore: 9, reason: 'rc', ts: 3 }, // 差2,留
    { topic_id: 'd', title: 'd', aiScore: 8, userScore: 8, reason: 'rd', ts: 4 }, // 差0,排除
  ];
  const c = corrections(fb);
  assert.equal(c.length, 2);
  assert.equal(c[0].topic_id, 'c'); // ts 降序:3>2
  assert.equal(c[1].topic_id, 'b');
});

test('recordTokens: 累加当日 + calls + 剪枝>30天', async () => {
  const s = mockStore();
  await s.set('tokenUsage', { '2026-06-01': { prompt: 10, completion: 5, total: 15, calls: 1 } }); // >30天前
  await recordTokens(s, '2026-07-07', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, { today: '2026-07-07' });
  await recordTokens(s, '2026-07-07', { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }); // 再记一次
  const u = await getTokenUsage(s);
  assert.deepEqual(u['2026-07-07'], { prompt: 150, completion: 30, total: 180, calls: 2 });
  assert.ok(!u['2026-06-01'], '旧记录应被剪枝');
});

test('recordTokens: usage 为 null 时跳过', async () => {
  const s = mockStore();
  await recordTokens(s, '2026-07-07', null);
  const u = await getTokenUsage(s);
  assert.deepEqual(u, {});
});
```

- [ ] **Step 2:** 运行确认失败:`cd /Users/byron/zsxq-clipper && /Users/byron/.hermes/node/bin/node --test tests/feedback.test.mjs` → FAIL(模块不存在)
- [ ] **Step 3:** 实现 `lib/feedback.mjs`:
```javascript
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
```
- [ ] **Step 4:** 运行确认通过(4 测试 PASS)
- [ ] **Step 5:** Commit `feat: lib/feedback 反馈存储 + token 用量记录`

---

## Task 2: lib/ai-scorer.mjs — buildPrompt/scoreOne + guidance 生成

**Files:** Modify `lib/ai-scorer.mjs`、`tests/ai-scorer.test.mjs`

> 现状:`buildPrompt({focus,text})`、`scoreOne(topic, opts)` 调 `buildPrompt(topic)`(topic 即 {text,focus})、`parseAIJson`、`resolveEndpoint`、`PROVIDERS`。

- [ ] **Step 1:** 写失败测试(追加到 `tests/ai-scorer.test.mjs` 末尾;顶部 import 加 `buildGuidancePrompt, regenerateGuidance`):
```javascript
import { buildPrompt, scoreOne, buildGuidancePrompt, regenerateGuidance } from '../lib/ai-scorer.mjs';

test('buildPrompt: feedback/guidance 段在 system 里', () => {
  const msgs = buildPrompt({
    focus: 'AI', text: '正文',
    guidance: '偏好实战类',
    feedback: [{ topic_id: 't1', title: '标题A', textSnippet: '片段', aiScore: 9, userScore: 5, reason: '太水', ts: 1 }]
  });
  const sys = msgs[0].content;
  assert.ok(sys.includes('【评分指引】'));
  assert.ok(sys.includes('偏好实战类'));
  assert.ok(sys.includes('【用户品味参考'));
  assert.ok(sys.includes('标题A'));
  assert.ok(sys.includes('AI 给 9 分'));
  assert.ok(sys.includes('用户认为该 5 分'));
});

test('buildPrompt: 无 feedback/guidance 时不加段', () => {
  const sys = buildPrompt({ focus: 'AI', text: 'x' })[0].content;
  assert.ok(!sys.includes('【评分指引】'));
  assert.ok(!sys.includes('【用户品味参考'));
});

test('scoreOne: 返回 usage(mock fetch)', async () => {
  const fakeFetch = async () => ({ json: async () => ({
    choices: [{ message: { content: '{"score":7,"reason":"ok","tags":[]}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  }) });
  const r = await scoreOne({ text: 'x' }, { fetch: fakeFetch, apiKey: 'k' });
  assert.equal(r.score, 7);
  assert.deepEqual(r.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
});

test('scoreOne: 无 usage 时 usage=null', async () => {
  const fakeFetch = async () => ({ json: async () => ({
    choices: [{ message: { content: '{"score":7,"reason":"ok","tags":[]}' } }]
  }) });
  const r = await scoreOne({ text: 'x' }, { fetch: fakeFetch, apiKey: 'k' });
  assert.equal(r.usage, null);
});

test('buildGuidancePrompt: 含全部 feedback 条目', () => {
  const msgs = buildGuidancePrompt([{ title: 'T1', aiScore: 9, userScore: 5, reason: 'r1' }]);
  assert.ok(msgs[1].content.includes('T1'));
  assert.ok(msgs[1].content.includes('r1'));
});

test('regenerateGuidance: 返回 guidance 文本 + usage', async () => {
  const fakeFetch = async () => ({ json: async () => ({
    choices: [{ message: { content: '偏好AI实战,降权水文。' } }],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
  }) });
  const r = await regenerateGuidance({ feedback: [{ title: 'T', aiScore: 9, userScore: 5, reason: 'r' }], fetch: fakeFetch, apiKey: 'k' });
  assert.equal(r.guidance, '偏好AI实战,降权水文。');
  assert.equal(r.usage.total_tokens, 70);
});
```
> 注:若 `tests/ai-scorer.test.mjs` 顶部已有 `import { ... } from '../lib/ai-scorer.mjs'`,把新名字合并进去,别重复 import 行。

- [ ] **Step 2:** 运行确认失败(新函数未导出 / buildPrompt 不含段)
- [ ] **Step 3:** 改 `lib/ai-scorer.mjs`。顶部加 import,改 buildPrompt,改 scoreOne,加 buildGuidancePrompt + regenerateGuidance:
```javascript
import { corrections } from './feedback.mjs';
```
buildPrompt 改为:
```javascript
export function buildPrompt({ focus, text, feedback, guidance } = {}) {
  let sys = '你是内容筛选助手。按"对该用户的有用程度"给帖子打1-10分。' +
    '只返回 JSON,格式 {"score":数字,"reason":"一句中文理由","tags":["标签"]}。用户关注领域:' + (focus || '通用');
  if (guidance) sys += '\n\n【评分指引】\n' + guidance;
  const corr = corrections(feedback || []);
  if (corr.length) {
    sys += '\n\n【用户品味参考(最近纠偏,据此校准你的打分倾向)】';
    for (const c of corr) {
      sys += `\n- 《${c.title || ''}》正文:${(c.textSnippet || '').slice(0, 80)}… AI 给 ${c.aiScore} 分,用户认为该 ${c.userScore} 分,理由:${c.reason || ''}`;
    }
  }
  return [
    { role: 'system', content: sys },
    { role: 'user', content: '帖子内容:\n' + (text || '').slice(0, 1500) }
  ];
}
```
scoreOne 改为(加 usage):
```javascript
export async function scoreOne(topic, { fetch: f = fetch, apiKey, model, provider = 'zhipu', endpoint } = {}) {
  const { endpoint: url, model: useModel } = resolveEndpoint({ provider, endpoint, model });
  const resp = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: useModel, messages: buildPrompt(topic), temperature: 0.3 })
  });
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = parseAIJson(content);
  const usage = data?.usage || null;
  return parsed ? { ...parsed, usage } : { score: 0, reason: 'AI 未返回有效评分', tags: [], usage };
}
```
末尾追加:
```javascript
// C: 用全部 feedback 让 LLM 综合成评分指引 guidance。
export function buildGuidancePrompt(feedback = []) {
  const items = feedback.length
    ? feedback.map(f => `- 《${f.title || ''}》AI=${f.aiScore},用户=${f.userScore}:${f.reason || ''}`).join('\n')
    : '(暂无反馈)';
  return [
    { role: 'system', content: '你是一个评分校准器。下面是用户对历史帖子评分的纠偏反馈(AI 原先评 aiScore,用户认为该 userScore)。请综合成一段简洁的"评分指引"(不超过200字),提炼用户偏好的选题规律与加减分倾向。直接输出指引文本,不要 JSON。' },
    { role: 'user', content: items }
  ];
}

export async function regenerateGuidance({ feedback, fetch: f = fetch, apiKey, model, provider = 'zhipu', endpoint } = {}) {
  const { endpoint: url, model: useModel } = resolveEndpoint({ provider, endpoint, model });
  const resp = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: useModel, messages: buildGuidancePrompt(feedback), temperature: 0.4 })
  });
  const data = await resp.json();
  const guidance = (data?.choices?.[0]?.message?.content || '').trim();
  return { guidance: guidance.slice(0, 600), usage: data?.usage || null };
}
```
- [ ] **Step 4:** 运行确认通过(`node --test tests/ai-scorer.test.mjs`)
- [ ] **Step 5:** Commit `feat: ai-scorer buildPrompt 注入 feedback/guidance + scoreOne 返回 usage + guidance 重生成`

---

## Task 3: lib/cache.mjs keyFor 加 guidanceVersion

**Files:** Modify `lib/cache.mjs`

- [ ] **Step 1:** 改 `keyFor`(让 guidance 更新后旧 utility 缓存失效):
```javascript
export function keyFor(topic, guidanceVersion = 0) {
  return `${topic.topic_id}_${hash(topic.text || '')}_v${guidanceVersion}`;
}
```
- [ ] **Step 2:** 检查现有测试:`grep -rn "keyFor" tests/`。若有断言旧格式(无 `_v0`),更新为含 `_v0`。若无 keyFor 测试,跳过。
- [ ] **Step 3:** 运行全量 `node --test "tests/**/*.mjs"` 确认通过。
- [ ] **Step 4:** Commit `feat: cache keyFor 纳入 guidanceVersion(指引更新失效旧分)`

---

## Task 4: background.js — 自动 regen + token 记录 + 透传 + addFeedback handler

**Files:** Modify `background.js`

> 现状:`import { fetchToday, fetchComments }` / `{ computeFreshness... }` / `{ scoreOne }`;`store`(chrome.storage 包装,get/set);`cache = makeCache(store)`;`handleScanToday({groupId,todayStr,sinceDays,history})`;onMessage 有 clip/fetchArticle/scanToday/fetchComments/openOptions。

- [ ] **Step 1:** 顶部 import 调整:
```javascript
import { coarseFilter } from './lib/filter.mjs';
import { scoreOne, regenerateGuidance } from './lib/ai-scorer.mjs';
import { makeCache, keyFor } from './lib/cache.mjs';
import { fetchToday, fetchComments } from './lib/zsxq-api.mjs';
import { computeFreshness, computeNovelty, computeTotalScore } from './lib/scorer.mjs';
import { addFeedback, recordTokens } from './lib/feedback.mjs';
```
- [ ] **Step 2:** 改 `handleScanToday` —— 开头读 feedback/guidance/guidanceVersion/feedbackSeen 并自动 regen;评分透传 feedback/guidance、记 token、keyFor 带 guidanceVersion。把现有 `handleScanToday` 函数体替换为:
```javascript
async function handleScanToday({ groupId, todayStr, sinceDays = 1, history = [] }) {
  const cfg = await chrome.storage.local.get(['apiKey', 'focus', 'model', 'provider', 'endpoint', 'feedback', 'guidance', 'guidanceVersion', 'feedbackSeen']);
  const { apiKey, focus, model, provider, endpoint } = cfg;
  if (!apiKey) return { ok: false, error: '未设置 API key,请点 ⚙️ 填写' };

  let feedback = cfg.feedback || [];
  let guidance = cfg.guidance || '';
  let guidanceVersion = cfg.guidanceVersion || 0;
  const feedbackSeen = cfg.feedbackSeen || 0;

  // C: 攒满 20 条新增反馈 → 自动重生成 guidance(失败降级,不阻塞)
  if (feedback.length - feedbackSeen >= 20 && feedback.length >= 20) {
    try {
      const r = await regenerateGuidance({ feedback, fetch, apiKey, model, provider, endpoint });
      if (r.usage) await recordTokens(store, todayStr, r.usage);
      if (r.guidance) {
        guidance = r.guidance;
        guidanceVersion += 1;
        await chrome.storage.local.set({ guidance, guidanceVersion, feedbackSeen: feedback.length });
      }
    } catch (e) { console.warn('[精选] guidance 重生成失败,下次再试:', e.message); }
  }

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
    const ck = keyFor(t, guidanceVersion);
    const hit = await cache.get(ck, todayStr);
    let utility;
    if (hit && typeof hit.utility === 'number') {
      utility = hit;                                   // 命中:复用,跳过评论/token
    } else {
      let comments = [];
      try { comments = await fetchComments({ topicId: t.topic_id }); }
      catch (e) { /* 降级:无评论 */ }
      const topComments = comments.slice(0, 3)
        .map(c => `- ${c.text.replace(/\n/g, ' ').slice(0, 200)}(赞${c.likes})`).join('\n');
      const textForAI = topComments ? `${t.text}\n\n精选评论:\n${topComments}` : t.text;
      try {
        const s = await scoreOne({ text: textForAI, focus, feedback, guidance }, { apiKey, model, provider, endpoint });
        if (s.usage) await recordTokens(store, todayStr, s.usage);
        utility = { utility: s.score, reason: s.reason, tags: s.tags };
        await cache.set(ck, utility, todayStr);
      } catch (e) {
        utility = { utility: 0, reason: 'AI 评分失败', tags: [] };
      }
    }
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
- [ ] **Step 3:** 加 `addFeedback` 消息 handler(在 `fetchComments` handler 之后、`openOptions` 之前):
```javascript
  if (msg.type === 'addFeedback') {
    addFeedback(store, msg.entry)
      .then(feedback => sendResponse({ ok: true, feedback }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
```
- [ ] **Step 4:** `node --check background.js` 通过。
- [ ] **Step 5:** Commit `feat: background 自动 regen guidance + token 记录 + feedback/guidance 透传`

---

## Task 5: content.js — 卡片 [✎ 我评] 表单 + 已评标记

**Files:** Modify `content.js`

> 现状:`renderCuration(topics)`(content.js:784)渲染卡片,含 📋收 + 📄全文 按钮;`scanToday` 回调与 `closeReader` 都调它。`chrome.storage.local` 在 content 可直接用(已有 loadSettings/saveSettings)。

- [ ] **Step 1:** `renderCuration` 改 async,开头读 feedback 建 topic_id→userScore 映射;卡片模板加 [✎ 我评] 按钮 + 内联表单 + 已评标记。把 `function renderCuration(topics) {` 整段替换为:
```javascript
  async function renderCuration(topics) {
    lastCurTopics = topics;
    const list = document.getElementById('zsxq-curation-list');
    if (!list) return;
    if (!topics || !topics.length) { list.innerHTML = '<div>该时间段无内容</div>'; return; }
    const fb = (await chrome.storage.local.get('feedback')).feedback || [];
    const rated = {}; for (const f of fb) rated[f.topic_id] = f.userScore;
    list.innerHTML = topics.map((t, i) => {
      const dt = t.create_time ? new Date(t.create_time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
      const imgs = (t.images && t.images.length) ? '<div style="margin-top:4px">' + t.images.map(u => `<a href="${escHtml(u)}" target="_blank" rel="noopener" style="color:#7aa2ff;font-size:11px;margin-right:6px">🖼 图</a>`).join('') + '</div>' : '';
      const mark = rated[t.topic_id] != null ? ` <span style="color:#4ecca3;font-size:10px">✓ 你评${escHtml(rated[t.topic_id])}</span>` : '';
      return `
        <div style="background:#222244;border-radius:6px;padding:8px;margin-bottom:6px">
          <div>⭐${escHtml(t.score)} <b>${escHtml(t.title)}</b>${mark}</div>
          <div style="color:#8b8baf;font-size:11px">${escHtml(dt)} · ${escHtml(t.author)} · ❤️${escHtml(t.likes)} · 💬${escHtml(t.comments)}</div>
          <div style="color:#aaa;font-size:11px;margin:3px 0">${escHtml(t.reason || '')}</div>
          <div style="color:#9a9aff;font-size:10px;margin:2px 0">F${escHtml(t.freshness)} · N${escHtml(t.novelty)} · U${escHtml(t.utility)}</div>
          <button class="zsxq-cur-save" data-id="${escHtml(t.topic_id)}" style="font-size:11px;padding:2px 8px;background:#4ecca3;border:0;border-radius:3px;cursor:pointer;color:#111">📋 收</button>
          <button class="zsxq-cur-full-btn" data-i="${i}" style="font-size:11px;padding:2px 8px;background:#333;border:0;border-radius:3px;cursor:pointer;color:#eee;margin-left:6px">📄 全文</button>
          <button class="zsxq-cur-rate-btn" data-i="${i}" data-score="${escHtml(rated[t.topic_id] != null ? rated[t.topic_id] : '')}" data-reason="" style="font-size:11px;padding:2px 8px;background:#333;border:0;border-radius:3px;cursor:pointer;color:#eee;margin-left:6px">✎ 我评</button>
          <div class="zsxq-cur-rate-form" data-i="${i}" style="display:none;margin-top:6px">分:<select class="zsxq-rate-score">${[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}</option>`).join('')}</select> <input class="zsxq-rate-reason" placeholder="理由(可选)" style="background:#11112a;color:#eee;border:1px solid #333;border-radius:3px;padding:2px 6px;font-size:11px;width:60%"> <button class="zsxq-rate-save" style="font-size:11px;padding:2px 8px;background:#4ecca3;border:0;border-radius:3px;cursor:pointer;color:#111">保存</button></div>
        </div>`;
    }).join('');
    list.querySelectorAll('.zsxq-cur-save').forEach(b =>
      b.addEventListener('click', () => saveFromCur(b.dataset.id, topics)));
    list.querySelectorAll('.zsxq-cur-full-btn').forEach(b =>
      b.addEventListener('click', () => expandReader(parseInt(b.dataset.i, 10), topics)));
    list.querySelectorAll('.zsxq-cur-rate-btn').forEach(b =>
      b.addEventListener('click', () => {
        const i = b.dataset.i;
        const form = list.querySelector(`.zsxq-cur-rate-form[data-i="${i}"]`);
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
      }));
    list.querySelectorAll('.zsxq-rate-save').forEach(b =>
      b.addEventListener('click', () => saveFeedback(b, topics)));
  }

  // [✎ 我评] 保存:发 addFeedback 给 background(走 lib 覆盖+上限),成功后标记卡片
  function saveFeedback(saveBtn, topics) {
    const card = saveBtn.closest('div[style*="222244"]');
    const i = card.querySelector('.zsxq-cur-rate-btn').dataset.i;
    const t = topics[parseInt(i, 10)];
    if (!t) return;
    const userScore = parseInt(card.querySelector('.zsxq-rate-score').value, 10);
    const reason = card.querySelector('.zsxq-rate-reason').value.trim();
    const entry = {
      topic_id: t.topic_id, title: (t.title || '').slice(0, 50),
      textSnippet: (t.text || '').slice(0, 80), aiScore: t.score, userScore, reason, ts: Date.now()
    };
    saveBtn.textContent = '...';
    chrome.runtime.sendMessage({ type: 'addFeedback', entry }, resp => {
      if (resp && resp.ok) {
        card.querySelector('.zsxq-cur-rate-form').style.display = 'none';
        // 更新标记
        const mark = card.querySelector('span[style*="4ecca3"]');
        if (mark) mark.remove();
        const titleDiv = card.querySelector('div');
        titleDiv.insertAdjacentHTML('beforeend', ` <span style="color:#4ecca3;font-size:10px">✓ 你评${userScore}</span>`);
        lastCurTopics = topics; // 保持引用
      } else {
        saveBtn.textContent = '保存';
        alert('反馈保存失败: ' + (resp?.error || '未知'));
      }
    });
  }
```
- [ ] **Step 2:** `node --check content.js` 通过。
- [ ] **Step 3:** Commit `feat: 卡片 [✎ 我评] 内联反馈表单 + 已评标记`

---

## Task 6: content.js — 设置面板 token 柱状图

**Files:** Modify `content.js`

> 现状:设置面板 `#zsxq-settings-panel`(injectSidebar 内联 HTML),`loadSettings` 在展开时读 chrome.storage.local 填字段。

- [ ] **Step 1:** 在 `injectSidebar` 的设置面板 HTML 里(`#zsxq-settings-panel` 内,`#zsxq-set-save` 按钮之后)加一个 token 区块:
```html
          <div style="margin-top:8px;border-top:1px solid #333;padding-top:6px">
            <div style="color:#4ecca3;font-size:11px;margin-bottom:4px">📊 Token 用量(近7天)</div>
            <div id="zsxq-token-chart" style="display:flex;align-items:flex-end;gap:3px;height:48px"></div>
            <div id="zsxq-token-summary" style="color:#8b8baf;font-size:10px;margin-top:3px"></div>
          </div>
```
- [ ] **Step 2:** 加 `renderTokenChart()` 函数(在 `loadSettings` 附近),并在 `loadSettings` 末尾调一次:
```javascript
  function renderTokenChart() {
    chrome.storage.local.get('tokenUsage', r => {
      const u = r.tokenUsage || {};
      const box = document.getElementById('zsxq-token-chart');
      const sum = document.getElementById('zsxq-token-summary');
      if (!box) return;
      // 近 7 天日期键(UTC,YYYY-MM-DD)
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const dt = new Date(Date.UTC(...(d => [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()])(new Date())));
        dt.setUTCDate(dt.getUTCDate() - i);
        days.push(dt.toISOString().slice(0, 10));
      }
      const vals = days.map(d => (u[d] && u[d].total) || 0);
      const max = Math.max(1, ...vals);
      box.innerHTML = days.map((d, i) => {
        const v = vals[i];
        const h = Math.round((v / max) * 100);
        const dd = d.slice(5);
        return `<div title="${d}: ${v} tokens" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%"><span style="font-size:8px;color:#666">${dd}</span><div style="width:100%;background:${v ? '#4ecca3' : '#333'};height:${h}%;border-radius:2px"></div></div>`;
      }).join('');
      const today = days[6];
      const t = u[today];
      if (sum) sum.textContent = `今日 ${today.slice(5)}: ${t ? t.total : 0} tokens / ${t ? t.calls : 0} 次`;
    });
  }
```
并在 `loadSettings` 末尾(`toggleEndpointField();` 之后)加 `renderTokenChart();`。
- [ ] **Step 3:** `node --check content.js` 通过。
- [ ] **Step 4:** Commit `feat: 设置面板 token 用量 7 日柱状图`

---

## Task 7: 端到端验证

**Files:** 无(手动,用 chrome-devtools-mcp)

- [ ] **Step 1:** 重载扩展(chrome://extensions → 知识星球剪藏 → 🔄,用 shadow DOM `#dev-reload-button` 点击)。
- [ ] **Step 2:** 全量单测 `node --test "tests/**/*.mjs"` 通过。
- [ ] **Step 3:** 刷新星球页 → 扫描近 7 天 → 卡片有 [✎ 我评] 按钮;点一张卡 [✎ 我评] → 选分 + 填理由 → 保存 → 卡上出现 `✓ 你评 N`。
- [ ] **Step 4:** 打开 ⚙️ 设置面板 → 底部 `📊 Token 用量(近7天)` 柱状图渲染(今日列有值,因刚扫描花了 token)。
- [ ] **Step 5:** 验证 B/C(若愿):用 chrome-devtools 往 chrome.storage.local 注入 20 条假 feedback(含纠偏)→ 触发一次扫描 → 观察 console 是否 regen guidance(或 storage.local 里 guidance 非空、guidanceVersion+1)。B 的 few-shot 段进 prompt(难直接观测,信任单测)。
- [ ] **Step 6:** 若全过,无新 commit(纯验证);有 bug 定位修复。

---

## 依赖关系

- Task 1(feedback lib)→ Task 2(ai-scorer 用 corrections)、Task 4(background 用 addFeedback/recordTokens)
- Task 2 → Task 4(scoreOne/regenerateGuidance)
- Task 3(cache)→ Task 4(keyFor 带 guidanceVersion)
- Task 4 → Task 5(addFeedback handler)、Task 7
- Task 5、6 都改 content.js(顺序执行,Task 6 在 Task 5 后)
- Task 7 最后

## Self-Review 已做
- spec 覆盖:① 数据模型(Task1 store keys)② 卡片反馈 UI(Task5)③ B few-shot(Task2 buildPrompt)④ C 自动 regen(Task2 regenerateGuidance + Task4 编排)⑤ cache 迭代(Task3+Task4)⑥ token 记录(Task1 recordTokens + Task4 采集 + Task6 柱状图)—— 全覆盖
- 无 placeholder(每步含完整代码/命令)
- 类型一致:`addFeedback(store, entry, cap)` / `corrections(feedback, limit)` / `recordTokens(store, dateStr, usage, {today,keepDays})` / `regenerateGuidance({feedback,...})` / `keyFor(topic, guidanceVersion)` / scoreOne 返回 `{score,reason,tags,usage}` / entry 含 `{topic_id,title,textSnippet,aiScore,userScore,reason,ts}` —— 跨 task 一致
- entry 的 ts:Task5 用 `Date.now()`(单调),Task1 cap 靠插入序淘汰最旧 —— 一致
