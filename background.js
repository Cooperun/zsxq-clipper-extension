// background.js v5.5 — Service Worker
// 1. 代理 fetch 到本地服务
// 2. 用后台 tab 打开 articles.zsxq.com 外链，等渲染后提取正文

const SERVER = 'http://127.0.0.1:8765/clip';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[剪藏] background.js v5.5 loaded');
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 解析短链接，获取真实 URL
async function resolveShortUrl(url) {
  if (!url.includes('t.zsxq.com')) return url;
  
  try {
    // 用 fetch 跟随重定向获取真实 URL
    const resp = await fetch(url, { 
      method: 'HEAD', 
      redirect: 'follow',
      credentials: 'include'  // 带上 cookies
    });
    return resp.url || url;
  } catch (e) {
    console.warn('[剪藏] 短链接解析失败:', url, e.message);
    return url;
  }
}

async function fetchArticleViaTab(url) {
  // 先解析短链接
  const realUrl = await resolveShortUrl(url);
  console.log('[剪藏] 解析后 URL:', url, '→', realUrl);
  
  const tab = await chrome.tabs.create({ url: realUrl, active: false });
  
  try {
    // 等 SPA 渲染，最多等 8 秒
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // 检查 app-talk-content（帖子详情页）
            const talkContent = document.querySelector('app-talk-content');
            if (talkContent && talkContent.textContent.length > 100) {
              return { ready: true, textLength: talkContent.textContent.length };
            }
            
            // 检查编辑器区域（长文章）
            const editor = document.querySelector('.ql-editor') ||
                           document.querySelector('.milkdown-editor');
            if (editor && editor.textContent.length > 100) {
              return { ready: true, textLength: editor.textContent.length };
            }
            
            // 检查 .content 中是否有任何一个包含足够内容
            const contents = document.querySelectorAll('.content');
            for (const el of contents) {
              if (el.textContent.length > 200) {
                return { ready: true, textLength: el.textContent.length };
              }
            }
            
            // fallback: body 有足够内容就算 ready
            const bodyText = document.body?.textContent || '';
            return { ready: bodyText.length > 500, textLength: bodyText.length };
          }
        });
        if (results?.[0]?.result?.ready) break;
      } catch (e) {
        // tab 还在加载中
      }
    }

    // 提取正文 HTML
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 长文章页面的编辑器区域
        const editor = document.querySelector('.ql-editor') ||
                       document.querySelector('.milkdown-editor');
        // 帖子详情页的内容区域
        const talkContent = document.querySelector('app-talk-content');
        // 通用 .content（但要检查是否有实际内容）
        const genericContent = document.querySelector('.content');
        const hasGenericContent = genericContent && genericContent.textContent?.length > 100;
        
        const target = editor || talkContent || (hasGenericContent ? genericContent : null) || document.body;
        return target.innerHTML;
      }
    });

    return results?.[0]?.result || null;
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'clip') {
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
        if (html && html.length > 100) {
          sendResponse({ ok: true, html });
        } else {
          sendResponse({ ok: false, error: `页面内容过短(${(html||'').length}bytes)` });
        }
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
