// zsxq-clipper/server.js v5.6 — 本地剪藏服务（含图片本地化）
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SAVE_DIR = path.join(process.env.HOME, 'zsxq-clips');
fs.mkdirSync(SAVE_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/clip') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const fn = (data.filename || 'untitled.md').replace(/[\\/:*?"<>|\n\r]/g, '_');
        const fp = path.join(SAVE_DIR, fn);
        fs.writeFileSync(fp, data.content || '', 'utf-8');
        console.log(`[OK] ${fp}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: fp }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // 图片保存端点：接收 { folder, filename, data(base64), mime }
  if (req.method === 'POST' && req.url === '/save-image') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const folder = (data.folder || 'assets').replace(/[\\/:*?"<>|\n\r]/g, '_');
        const assetsDir = path.join(SAVE_DIR, 'assets', folder);
        fs.mkdirSync(assetsDir, { recursive: true });

        // 从 mime 推断扩展名
        const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
        const ext = extMap[data.mime] || '.jpg';

        // 用 URL hash 做文件名，避免重复下载
        const hash = data.urlHash || crypto.randomBytes(8).toString('hex');
        const imgFn = `${hash}${ext}`;
        const imgPath = path.join(assetsDir, imgFn);

        if (fs.existsSync(imgPath)) {
          // 已存在，跳过
          console.log(`[IMG skip] ${imgFn}`);
        } else {
          const buf = Buffer.from(data.data, 'base64');
          fs.writeFileSync(imgPath, buf);
          console.log(`[IMG saved] ${imgPath} (${buf.length} bytes)`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: `assets/${folder}/${imgFn}` }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(8765, '127.0.0.1', () => {
  console.log(`[剪藏服务] http://127.0.0.1:8765 → ${SAVE_DIR}`);
});
