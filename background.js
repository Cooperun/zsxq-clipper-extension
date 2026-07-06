// background.js v6 — ESM Service Worker
import { coarseFilter } from './lib/filter.mjs';
import { scoreOne } from './lib/ai-scorer.mjs';
import { makeCache, keyFor } from './lib/cache.mjs';
import { fetchToday, fetchComments } from './lib/zsxq-api.mjs';
import { computeFreshness, computeNovelty, computeTotalScore } from './lib/scorer.mjs';

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
  if (msg.type === 'openOptions') {
    // content script 调 openOptionsPage 不可靠,由 background 代理
    chrome.runtime.openOptionsPage().catch(() => {});
    return false;
  }
});
