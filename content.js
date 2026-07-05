// content.js v5.6 — 知识星球剪藏（图片本地化 + 后台Tab抓取SPA正文）
// 正确的选择器：app-topic-header / app-talk-content

(function () {
  'use strict';

  const CLIP_BTN_CLASS = 'zsxq-clip-btn';

  // 收集当前剪藏的所有图片 URL（用于后续下载）
  let collectedImages = [];

  // ===== File System Access 落盘（取代本地 server）=====
  const FS_DB = 'zsxq-clipper-fs';
  const FS_STORE = 'dirs';
  let dirHandle = null;

  // IndexedDB 句柄存取（极简）
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(FS_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(FS_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(store, key) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const t = db.transaction(store).objectStore(store).get(key);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  }
  async function idbSet(store, key, val) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const t = db.transaction(store, 'readwrite').objectStore(store).put(val, key);
      t.onsuccess = () => res();
      t.onerror = () => rej(t.error);
    });
  }

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

  // 递归创建 assets/<folder>/，写图片返回相对路径
  async function saveImageLocal(folder, hash, blob) {
    const dir = await getClipDir();
    const assetsDir = await dir.getDirectoryHandle('assets', { create: true });
    const subDir = await assetsDir.getDirectoryHandle(folder, { create: true });
    const ext = ((blob.type || 'image/jpeg').split('/')[1] || 'jpeg').replace('svg+xml', 'svg');
    const fh = await subDir.getFileHandle(`${hash}.${ext}`, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return `assets/${folder}/${hash}.${ext}`;
  }

  // 简单 hash（用 URL 生成短文件名）
  function hashUrl(url) {
    let h = 0;
    for (let i = 0; i < url.length; i++) {
      h = ((h << 5) - h + url.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  }

  // 提取帖子文本（递归，保留链接）
  function extractText(el) {
    if (el.nodeType === Node.TEXT_NODE) return el.textContent;
    if (el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return '';
    if (el.tagName === 'IMG') {
      const alt = el.getAttribute('alt');
      return alt ? `[${alt}]` : '';
    }
    let text = '';
    for (const child of el.childNodes) {
      if (child.tagName === 'A') {
        const linkText = child.textContent?.trim() || '';
        const href = child.getAttribute('href') || '';
        if (href && linkText && href !== linkText && !href.startsWith('javascript')) {
          text += `[${linkText}](${href})`;
        } else {
          text += linkText;
        }
      } else {
        text += extractText(child);
      }
    }
    const display = getComputedStyle(el).display;
    if (display === 'block' || display === 'flex' || display === 'list-item') {
      text += '\n';
    }
    return text;
  }

  function cleanText(text) {
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  // 通过 background.js 代理抓取外链页面（绕过 CORS）
  async function fetchArticleHtml(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'fetchArticle', url },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.ok) {
            resolve(response.html);
          } else {
            reject(new Error(response?.error || 'Fetch failed'));
          }
        }
      );
    });
  }

  // 从外链页面 HTML 提取正文，转为 Markdown
  // html 来自 background.js 后台 tab 的 innerHTML（已渲染）
  function htmlToMarkdown(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body || doc.documentElement;
    if (!body) return null;

    // 优先取编辑器区域（长文章），然后是帖子详情页内容区域
    const editor = body.querySelector('.ql-editor') ||
                   body.querySelector('.milkdown-editor');
    const genericContent = body.querySelector('.content');
    const hasGenericContent = genericContent && genericContent.textContent?.length > 100;
    const root = editor || (hasGenericContent ? genericContent : null) || body;

    // 从整个 body 收集图片（包括 app-image-gallery 等）
    // 用 Set 避免重复收集
    const bodyImages = new Set();
    body.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (src && !src.includes('zsxq.com/Fg_DES9') && !src.startsWith('data:')) {
        bodyImages.add(src);
      }
    });

    let mdLines = [];
    const walkEl = (el) => {
      if (el.nodeType === Node.TEXT_NODE) {
        const t = el.textContent.trim();
        if (t) mdLines.push(t);
        return;
      }
      if (el.nodeType !== Node.ELEMENT_NODE) return;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
      if (el.tagName === 'META' || el.tagName === 'HEAD') return;

      // 跳过页脚/无关区域
      const cls = el.classList;
      if (cls && (
        cls.contains('footer') || cls.contains('contentinfo') ||
        cls.contains('group-info') || cls.contains('author-info') ||
        cls.contains('title-mark') || cls.contains('js_watermark') ||
        cls.contains('code-toolbar') || cls.contains('toolbar') ||
        cls.contains('copy-button') || cls.contains('lang-list')
      )) return;
      if (el.tagName === 'FOOTER') return;

      // 跳过代码块语言选择栏
      if (el.tagName === 'DIV' || el.tagName === 'SPAN') {
        const text = el.textContent?.trim() || '';
        if (text.includes('javascript') && text.includes('Copy') && text.length < 300 && !el.querySelector('pre, code, .ql-editor')) {
          return;
        }
      }

      const tag = el.tagName.toLowerCase();

      if (tag === 'h1') return; // 标题已从帖子摘要获取
      if (tag === 'h2') { mdLines.push('', `## ${el.textContent.trim()}`, ''); return; }
      if (tag === 'h3') { mdLines.push('', `### ${el.textContent.trim()}`, ''); return; }
      if (tag === 'h4') { mdLines.push('', `#### ${el.textContent.trim()}`, ''); return; }
      if (tag === 'img') {
        const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
        const alt = el.getAttribute('alt') || '';
        if (src && !src.includes('zsxq.com/Fg_DES9') && !src.startsWith('data:')) {
          collectedImages.push(src);
          mdLines.push(`![${alt}](${src})`);
        }
        return;
      }
      if (tag === 'br') { mdLines.push(''); return; }
      if (tag === 'strong' || tag === 'b') { const t = el.textContent.trim(); if (t) mdLines.push(`**${t}**`); return; }
      if (tag === 'em' || tag === 'i') { const t = el.textContent.trim(); if (t) mdLines.push(`*${t}*`); return; }
      if (tag === 'code') { const t = el.textContent.trim(); if (t) mdLines.push(`\`${t}\``); return; }
      if (tag === 'pre') { mdLines.push('', '```', el.textContent.trim(), '```', ''); return; }
      if (tag === 'blockquote') { const t = el.textContent.trim(); if (t) mdLines.push(`> ${t.replace(/\n/g, '\n> ')}`); return; }
      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        const t = el.textContent.trim();
        if (href && t && href !== t) mdLines.push(`[${t}](${href})`);
        else if (t) mdLines.push(t);
        return;
      }
      if (tag === 'table') {
        const rows = el.querySelectorAll('tr');
        rows.forEach((row, idx) => {
          const cells = [...row.querySelectorAll('th, td')].map(c => c.textContent.trim());
          mdLines.push('| ' + cells.join(' | ') + ' |');
          if (idx === 0) mdLines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
        });
        mdLines.push('');
        return;
      }
      if (tag === 'li') {
        const prefix = el.parentElement?.tagName === 'OL' ? '1.' : '-';
        mdLines.push(`${prefix} ${el.textContent.trim()}`);
        return;
      }

      // 通用：递归子元素
      for (const child of el.childNodes) walkEl(child);
      // block 级元素后加空行
      if (['div', 'p', 'section', 'blockquote', 'ul', 'ol', 'pre', 'table'].includes(tag)) {
        mdLines.push('');
      }
    };

    walkEl(root);
    
    // 把从整个 body 收集的图片添加到 collectedImages（避免重复）
    bodyImages.forEach(src => {
      if (!collectedImages.includes(src)) {
        collectedImages.push(src);
      }
    });
    
    let md = mdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (md.length < 100) return null;
    return { md, images: Array.from(bodyImages) };
  }

  // 提取帖子信息
  function extractTopic(appTopic) {
    const container = appTopic.querySelector('.topic-container') || appTopic;

    // 作者：app-topic-header .author 里的文本
    const header = container.querySelector('app-topic-header');
    const authorEl = header?.querySelector('.author');
    const authorRaw = authorEl?.textContent?.trim() || '';
    // authorRaw 可能是 "stormzhang2026-05-20 00:01" 需要分离
    const authorMatch = authorRaw.match(/^(.+?)(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})$/);
    const author = authorMatch ? authorMatch[1].trim() : authorRaw.replace(/\d{4}-\d{2}-\d{2}.+$/, '').trim() || '未知作者';

    // 时间
    const timeEl = header?.querySelector('.create-time, .time, [class*="time"]');
    let time = '';
    if (timeEl) {
      time = timeEl.textContent?.trim() || '';
    }
    // 从 authorRaw 提取时间
    if (!time && authorMatch) {
      time = authorMatch[2];
    }
    // 最后从整个 header 里用正则找时间
    if (!time) {
      const headerText = header?.textContent || '';
      const timeMatch = headerText.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
      if (timeMatch) time = timeMatch[1];
    }

    // 正文：app-talk-content .content
    const contentEl = container.querySelector('app-talk-content .content');
    let content = '';
    if (contentEl) {
      content = cleanText(extractText(contentEl));
    }

    // 检测外链 — 支持 articles.zsxq.com（长文章）和 t.zsxq.com（短链接）
    const articleUrls = [];
    if (contentEl) {
      const links = contentEl.querySelectorAll('a[href*="articles.zsxq.com"], a[href*="t.zsxq.com"]');
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (href && !articleUrls.includes(href)) {
          articleUrls.push(href);
        }
      });
    }

    // 标题：正文的第一行或前30字
    let title = '';
    const firstLine = content.split('\n')[0]?.trim() || '';
    if (firstLine.length > 5) {
      title = firstLine.substring(0, 50);
    }

    // 标签
    const tags = [];
    const tagEls = container.querySelectorAll('app-tag-container a, .tag-container a');
    tagEls.forEach(t => {
      const tagText = t.textContent?.trim()?.replace(/^#/, '') || '';
      if (tagText) tags.push(tagText);
    });

    // 评论
    const comments = [];
    const commentBox = container.querySelector('.comment-box');
    if (commentBox) {
      // 每条评论的结构：作者 + 冒号 + 内容 + 时间
      const commentItems = commentBox.querySelectorAll('.comment-item');
      if (commentItems.length > 0) {
        commentItems.forEach(c => {
          const cAuthor = c.querySelector('.user-name, .author')?.textContent?.trim() || '';
          const cText = c.querySelector('.text, .comment-text')?.textContent?.trim() || '';
          const cTime = c.querySelector('.create-time, .time')?.textContent?.trim() || '';
          if (cText) comments.push({ author: cAuthor, text: cText, time: cTime });
        });
      } else {
        // 知识星球的评论可能是扁平的文本节点
        const commentText = cleanText(extractText(commentBox));
        if (commentText) {
          // 按评论模式分割
          const parts = commentText.split(/\n(?=\S+?\s*[：:])/);
          parts.forEach(part => {
            const match = part.match(/^(.+?)\s*[：:]\s*([\s\S]+?)(?:\n(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}))?$/);
            if (match) {
              comments.push({ author: match[1].trim(), text: match[2].trim(), time: match[3] || '' });
            }
          });
        }
      }
    }

    // 提问者信息（如果有）
    const questionEl = container.querySelector('.question, [class*="question"]');
    let question = '';
    if (questionEl) {
      question = cleanText(extractText(questionEl));
    }

    return { author, time, title, content, tags, comments, question, articleUrls };
  }

  // 生成 Markdown
  function toMarkdown(topic, articleContents, articleErrors, articleImages) {
    let md = `# ${topic.title || '知识星球帖子'}\n\n`;
    md += `- **作者**: ${topic.author}\n`;
    if (topic.time) md += `- **时间**: ${topic.time}\n`;
    if (topic.tags.length > 0) md += `- **标签**: ${topic.tags.join(', ')}\n`;
    md += `- **来源**: 知识星球\n\n`;
    md += `---\n\n`;

    if (topic.question) {
      md += `## 提问\n\n${topic.question}\n\n---\n\n`;
    }

    // 保留原文
    md += `${topic.content}\n`;

    // 如果有外链正文，附加在后面
    if (articleContents && articleContents.length > 0) {
      const validContents = articleContents.filter(c => c);
      if (validContents.length > 0) {
        md += `\n---\n## 外链正文\n\n`;
        md += validContents.join('\n\n---\n\n') + '\n';
      }
    }

    // 如果有外链图片，添加图片部分
    if (articleImages && articleImages.length > 0) {
      md += `\n---\n## 图片\n\n`;
      articleImages.forEach(img => {
        md += `![](${img})\n\n`;
      });
    }

    // 如果有外链但部分未成功抓取，保留链接
    if (topic.articleUrls && topic.articleUrls.length > 0) {
      const failedUrls = topic.articleUrls.filter((url, i) => !articleContents[i]);
      if (failedUrls.length > 0) {
        md += `\n> ⚠️ 以下外链正文未能抓取：\n`;
        failedUrls.forEach(url => {
          const err = articleErrors?.[topic.articleUrls.indexOf(url)] || '';
          md += `> - ${url}`;
          if (err) md += `（原因：${err}）`;
          md += '\n';
        });
        md += '\n';
      }
    }

    if (topic.comments.length > 0) {
      md += `\n---\n## 评论\n\n`;
      topic.comments.forEach(c => {
        md += `- **${c.author}**`;
        if (c.time) md += ` (${c.time})`;
        md += `：${c.text}\n`;
      });
    }
    return md;
  }

  // 添加剪藏按钮
  function addClipButton(appTopic) {
    if (appTopic.querySelector('.' + CLIP_BTN_CLASS)) return;

    let actionBar = appTopic.querySelector('.operation-icon-container');
    if (!actionBar) {
      actionBar = appTopic.querySelector('.topic-container') || appTopic;
    }

    const btn = document.createElement('button');
    btn.className = CLIP_BTN_CLASS;
    btn.textContent = '📋 剪藏';
    btn.title = '剪藏为 Markdown（自动抓取外链正文）';
    btn.style.cssText = `
      background: linear-gradient(135deg, #7c3aed, #a855f7);
      color: white;
      border: none;
      padding: 4px 12px;
      border-radius: 14px;
      font-size: 12px;
      cursor: pointer;
      margin-left: 8px;
      transition: all 0.2s;
      white-space: nowrap;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.05)';
      btn.style.boxShadow = '0 2px 8px rgba(124,58,237,0.4)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = 'none';
    });

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      try {
        console.log('[剪藏] 开始剪藏...');
        collectedImages = []; // 重置图片收集
        const topic = extractTopic(appTopic);
        console.log('[剪藏] extractTopic 完成, articleUrls:', topic.articleUrls);

        // 第一步：检测外链（已完成，在 topic.articleUrls 中）
        // 第二步：循环抓取所有外链正文
        const articleContents = [];
        const articleErrors = [];
        const articleImages = [];
        
        if (topic.articleUrls && topic.articleUrls.length > 0) {
          for (let i = 0; i < topic.articleUrls.length; i++) {
            const url = topic.articleUrls[i];
            btn.textContent = `⏳ 抓取 ${i + 1}/${topic.articleUrls.length}...`;
            console.log(`[剪藏] 开始抓取外链 ${i + 1}/${topic.articleUrls.length}:`, url);
            try {
              const html = await fetchArticleHtml(url);
              console.log('[剪藏] fetchArticleHtml 返回, html长度:', html?.length);
              const result = htmlToMarkdown(html);
              if (result) {
                articleContents.push(result.md);
                articleImages.push(...(result.images || []));
              } else {
                articleContents.push(null);
              }
              articleErrors.push(null);
              console.log('[剪藏] htmlToMarkdown 结果:', result ? `成功, ${result.md.length}字, ${result.images?.length || 0}张图片` : 'null');
            } catch (err) {
              articleContents.push(null);
              articleErrors.push(err.message);
              console.warn('[剪藏] 外链正文抓取失败:', err.message);
            }
          }
        }

        const safeTitle = (topic.title || 'post').substring(0, 30).replace(/[\\/:*?"<>|\n]/g, '_');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `zsxq_${safeTitle}_${timestamp}.md`;
        // asset folder 只保留英文/数字，纯中文标题回退到时间戳
        const asciiTitle = safeTitle.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        const assetFolder = asciiTitle || timestamp;

        let md = toMarkdown(topic, articleContents, articleErrors, articleImages);

        // 下载图片到本地
        if (collectedImages.length > 0) {
          btn.textContent = `⏳ 下载图片 0/${collectedImages.length}`;
          const urlToLocal = {}; // url → local path 映射

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

          // 替换 markdown 中的图片 URL 为本地路径
          for (const [url, localPath] of Object.entries(urlToLocal)) {
            // 转义 URL 中特殊字符用于正则
            const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            md = md.replace(new RegExp(escaped, 'g'), localPath);
          }

          console.log('[剪藏] 图片本地化完成:', Object.keys(urlToLocal).length, '/', collectedImages.length);
        }

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
        btn.style.background = 'linear-gradient(135deg, #059669, #10b981)';
        const hasArticle = articleContents.some(c => c);
        console.log('[剪藏] 已保存:', savedPath, hasArticle ? '(含外链正文)' : '', collectedImages.length ? `(${collectedImages.length}张图片)` : '');
      } catch (err) {
        console.error('[剪藏] 错误:', err);
        btn.textContent = '❌ 失败';
        btn.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
      }

      setTimeout(() => {
        btn.textContent = '📋 剪藏';
        btn.style.background = 'linear-gradient(135deg, #7c3aed, #a855f7)';
      }, 2000);
    });

    actionBar.appendChild(btn);
  }

  // 监听 DOM
  const observer = new MutationObserver(() => {
    document.querySelectorAll('app-topic').forEach(addClipButton);
  });

  document.querySelectorAll('app-topic').forEach(addClipButton);
  observer.observe(document.body, { childList: true, subtree: true });

  // ===== 精选栏 =====
  function getGroupId() {
    const m = location.pathname.match(/group[s]?\/(\d+)/) || location.href.match(/group[s]?\/(\d+)/);
    return m ? m[1] : null;
  }

  function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  const BAR_KEY = 'zsxq-cur-bar-state';
  function loadBarState() { try { return JSON.parse(localStorage.getItem(BAR_KEY)) || {}; } catch (_) { return {}; } }
  function saveBarState(s) { localStorage.setItem(BAR_KEY, JSON.stringify({ ...loadBarState(), ...s })); }

  function toggleEndpointField() {
    const v = document.getElementById('zsxq-set-provider')?.value;
    const ep = document.getElementById('zsxq-set-endpoint');
    if (ep) ep.style.display = v === 'custom' ? 'block' : 'none';
  }
  function loadSettings() {
    chrome.storage.local.get(['apiKey', 'model', 'focus', 'provider', 'endpoint'], r => {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
      set('zsxq-set-provider', r.provider || 'zhipu');
      set('zsxq-set-key', r.apiKey);
      set('zsxq-set-endpoint', r.endpoint);
      set('zsxq-set-model', r.model);
      set('zsxq-set-focus', r.focus);
      toggleEndpointField();
    });
  }
  function saveSettings() {
    const v = id => document.getElementById(id)?.value?.trim() || '';
    chrome.storage.local.set({
      provider: v('zsxq-set-provider'),
      apiKey: v('zsxq-set-key'),
      endpoint: v('zsxq-set-endpoint'),
      model: v('zsxq-set-model'),
      focus: v('zsxq-set-focus')
    }, () => {
      const msg = document.getElementById('zsxq-set-msg');
      if (msg) { msg.textContent = '✓ 已保存'; setTimeout(() => msg.textContent = '', 1500); }
    });
  }

  function setFold(bar, fold) {
    const title = bar.querySelector('#zsxq-cur-title');
    const actions = bar.querySelector('#zsxq-cur-actions');
    const unfold = bar.querySelector('#zsxq-unfold');
    const list = bar.querySelector('#zsxq-curation-list');
    if (fold) {
      title.textContent = '⭐';
      actions.style.display = 'none';
      unfold.style.display = '';
      list.style.display = 'none';
      const panel = bar.querySelector('#zsxq-settings-panel');
      if (panel) panel.style.display = 'none';
      bar.style.width = 'auto';
      bar.style.maxHeight = 'none';
      bar.style.padding = '4px 10px';
      bar.setAttribute('data-folded', '1');
      saveBarState({ folded: true });
    } else {
      title.textContent = '⭐ AI 精选';
      actions.style.display = '';
      unfold.style.display = 'none';
      list.style.display = '';
      bar.style.width = '320px';
      bar.style.maxHeight = '80vh';
      bar.style.padding = '10px';
      bar.setAttribute('data-folded', '0');
      saveBarState({ folded: false });
    }
  }

  function makeDraggable(bar, handle) {
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return; // 点按钮不拖
      dragging = true;
      const rect = bar.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      bar.style.right = 'auto';
      bar.style.left = rect.left + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const nl = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - ox));
      const nt = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy));
      bar.style.left = nl + 'px';
      bar.style.top = nt + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = bar.getBoundingClientRect();
      saveBarState({ left: Math.round(rect.left), top: Math.round(rect.top) });
    });
  }

  function injectSidebar() {
    if (document.getElementById('zsxq-curation-bar')) return;
    const state = loadBarState();
    const bar = document.createElement('div');
    bar.id = 'zsxq-curation-bar';
    const posCss = state.left != null ? `left:${state.left}px;` : 'right:0;';
    bar.style.cssText = `position:fixed;${posCss}top:${state.top != null ? state.top : 60}px;width:320px;max-height:80vh;overflow-y:auto;background:#1a1a2e;color:#eee;z-index:99999;border:2px solid #4ecca3;border-radius:8px;padding:10px;font-size:13px;box-shadow:-2px 0 12px rgba(0,0,0,.4)`;
    bar.innerHTML = `
      <div id="zsxq-cur-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:move;user-select:none">
        <b id="zsxq-cur-title">⭐ AI 精选</b>
        <span id="zsxq-cur-actions">
          <button id="zsxq-settings-btn" title="设置(API key 等)" style="background:#333;border:0;border-radius:4px;padding:3px 7px;cursor:pointer;color:#eee;margin-right:4px">⚙️</button>
          <button id="zsxq-fold-btn" title="折叠成球" style="background:#333;border:0;border-radius:4px;padding:3px 7px;cursor:pointer;color:#eee;margin-right:4px">—</button>
          <button id="zsxq-scan-btn" style="background:#4ecca3;border:0;border-radius:4px;padding:3px 10px;cursor:pointer;color:#111">🔍 扫描</button>
        </span>
        <button id="zsxq-unfold" title="展开" style="display:none;background:#4ecca3;border:0;border-radius:4px;padding:3px 10px;cursor:pointer;color:#111;margin-left:8px">⤢</button>
      </div>
      <div id="zsxq-settings-panel" style="display:none;background:#11112a;border-radius:6px;padding:8px;margin-bottom:8px;font-size:12px">
        <div style="font-weight:bold;margin-bottom:6px">⚙️ 设置</div>
        <select id="zsxq-set-provider" style="width:100%;margin-bottom:4px;box-sizing:border-box;padding:3px;background:#222;color:#eee;border:1px solid #444;border-radius:3px"><option value="zhipu">智谱 GLM</option><option value="deepseek">DeepSeek</option><option value="custom">自定义</option></select>
        <input id="zsxq-set-key" type="password" placeholder="API Key" style="width:100%;margin-bottom:4px;box-sizing:border-box;padding:4px;background:#222;color:#eee;border:1px solid #444;border-radius:3px">
        <input id="zsxq-set-endpoint" placeholder="Endpoint(自定义时填)" style="display:none;width:100%;margin-bottom:4px;box-sizing:border-box;padding:4px;background:#222;color:#eee;border:1px solid #444;border-radius:3px">
        <input id="zsxq-set-model" placeholder="模型(留空用默认)" style="width:100%;margin-bottom:4px;box-sizing:border-box;padding:4px;background:#222;color:#eee;border:1px solid #444;border-radius:3px">
        <textarea id="zsxq-set-focus" rows="2" placeholder="关注领域(评分参考)" style="width:100%;margin-bottom:4px;box-sizing:border-box;padding:4px;background:#222;color:#eee;border:1px solid #444;border-radius:3px"></textarea>
        <button id="zsxq-set-save" style="background:#4ecca3;border:0;border-radius:4px;padding:4px 14px;cursor:pointer;color:#111">保存</button><span id="zsxq-set-msg" style="color:#4ecca3;margin-left:8px"></span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;color:#8b8baf">
        时间范围:
        <select id="zsxq-range" style="background:#222;color:#eee;border:1px solid #444;border-radius:3px;padding:2px 4px;flex:1">
          <option value="1">今日</option><option value="3">近 3 天</option><option value="7" selected>近 7 天</option><option value="30">近 30 天</option>
        </select>
      </div>
      <div id="zsxq-curation-list"><div style="color:#8b8baf">点「🔍 扫描」开始 · 点 ⚙️ 填 API key</div></div>`;
    document.body.appendChild(bar);
    document.getElementById('zsxq-scan-btn').addEventListener('click', scanToday);
    document.getElementById('zsxq-settings-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = document.getElementById('zsxq-settings-panel');
      const willOpen = panel.style.display === 'none';
      panel.style.display = willOpen ? 'block' : 'none';
      if (willOpen) loadSettings();
    });
    document.getElementById('zsxq-set-provider').addEventListener('change', toggleEndpointField);
    document.getElementById('zsxq-set-save').addEventListener('click', saveSettings);
    document.getElementById('zsxq-fold-btn').addEventListener('click', () => setFold(bar, true));
    document.getElementById('zsxq-unfold').addEventListener('click', () => setFold(bar, false));
    makeDraggable(bar, document.getElementById('zsxq-cur-head'));
    if (state.folded) setFold(bar, true);
  }

  async function scanToday() {
    const groupId = getGroupId();
    const list = document.getElementById('zsxq-curation-list');
    if (!list) return;
    if (!groupId) { list.innerHTML = '<div style="color:#ff6b6b">未识别到星球 ID</div>'; return; }
    const rangeSel = document.getElementById('zsxq-range');
    const sinceDays = parseInt(rangeSel?.value || '7', 10);
    list.innerHTML = `<div style="color:#ffc93c">⏳ 扫描近 ${sinceDays} 天,评分中(粗筛后逐条 AI 评,稍候)...</div>`;
    const todayStr = new Date().toDateString();
    chrome.runtime.sendMessage({ type: 'scanToday', groupId, todayStr, sinceDays }, resp => {
      if (chrome.runtime.lastError) { list.innerHTML = '<div style="color:#ff6b6b">❌ ' + escHtml(chrome.runtime.lastError.message) + '</div>'; return; }
      if (!resp || !resp.ok) { list.innerHTML = '<div style="color:#ff6b6b">❌ ' + escHtml(resp?.error || '失败') + '</div>'; return; }
      if (!resp.topics || !resp.topics.length) { list.innerHTML = '<div>' + escHtml(resp.note || '该时间段无内容') + '</div>'; return; }
      list.innerHTML = resp.topics.map((t, i) => {
        const dt = t.create_time ? new Date(t.create_time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
        const imgs = (t.images && t.images.length) ? '<div style="margin-top:4px">' + t.images.map(u => `<a href="${escHtml(u)}" target="_blank" rel="noopener" style="color:#7aa2ff;font-size:11px;margin-right:6px">🖼 图</a>`).join('') + '</div>' : '';
        return `
        <div style="background:#222244;border-radius:6px;padding:8px;margin-bottom:6px">
          <div>⭐${escHtml(t.score)} <b>${escHtml(t.title)}</b></div>
          <div style="color:#8b8baf;font-size:11px">${escHtml(dt)} · ${escHtml(t.author)} · ❤️${escHtml(t.likes)} · 💬${escHtml(t.comments)}</div>
          <div style="color:#aaa;font-size:11px;margin:3px 0">${escHtml(t.reason || '')}</div>
          <button class="zsxq-cur-save" data-id="${escHtml(t.topic_id)}" style="font-size:11px;padding:2px 8px;background:#4ecca3;border:0;border-radius:3px;cursor:pointer;color:#111">📋 收</button>
          <button class="zsxq-cur-full-btn" data-i="${i}" style="font-size:11px;padding:2px 8px;background:#333;border:0;border-radius:3px;cursor:pointer;color:#eee;margin-left:6px">📄 全文</button>
          <div class="zsxq-cur-full" data-i="${i}" style="display:none;margin-top:6px;padding:6px;background:#11112a;border-radius:4px;font-size:12px;max-height:240px;overflow-y:auto;white-space:pre-wrap;color:#ccc;line-height:1.5">${escHtml(t.text)}${imgs}</div>
        </div>`;
      }).join('');
      list.querySelectorAll('.zsxq-cur-save').forEach(b =>
        b.addEventListener('click', () => saveFromCur(b.dataset.id, resp.topics)));
      list.querySelectorAll('.zsxq-cur-full-btn').forEach(b =>
        b.addEventListener('click', () => {
          const full = list.querySelector(`.zsxq-cur-full[data-i="${b.dataset.i}"]`);
          if (full) full.style.display = full.style.display === 'none' ? 'block' : 'none';
        }));
    });
  }

  // 精选栏 [收]：从评分结果直接落盘（已有完整 text/images，无需重新抓 DOM）
  async function saveFromCur(topicId, topics) {
    const t = topics.find(x => String(x.topic_id) === String(topicId));
    if (!t) return;
    const md = `# ${t.title}\n\n- **作者**: ${t.author}\n- **AI评分**: ${t.score}\n- **理由**: ${t.reason || ''}\n\n---\n\n${t.text}\n`;
    const safe = (t.title || 'post').substring(0, 30).replace(/[\\/:*?"<>|\n]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    try {
      const p = await saveMarkdownLocal(`zsxq_${safe}_${ts}.md`, md);
      alert('✓ 已保存到 ' + p);
    } catch (e) {
      if (e.message === '未授权目录') {
        try { await authorizeDir(); alert('已授权目录,请重新点 [收]'); }
        catch (e2) { alert('授权失败: ' + e2.message); }
      } else {
        alert('保存失败: ' + e.message);
      }
    }
  }

  injectSidebar();

  console.log('[剪藏] v5.6 已加载（图片本地化），找到', document.querySelectorAll('app-topic').length, '个帖子');
})();
