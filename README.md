# 知识星球剪藏 (zsxq-clipper)

一个 Chrome 扩展,在知识星球(`wx.zsxq.com`)帖子上添加「剪藏」按钮,一键把帖子保存为本地 Markdown 文件,支持抓取文章外链正文与图片本地化。

## 功能

- 📋 在每个帖子操作栏注入「剪藏」按钮,**逐篇**保存
- 🔗 自动抓取 `articles.zsxq.com` 长文章和 `t.zsxq.com` 短链接正文(后台 tab 渲染 SPA 后提取)
- 🖼️ 正文图片自动下载到本地,Markdown 中的图片地址替换为本地相对路径
- 💾 帖子保存为 `~/zsxq-clips/zsxq_<标题>_<时间>.md`,图片存到 `assets/<标题>/`

## 原理

```
wx.zsxq.com 帖子
  │  content.js 给每个 app-topic 注入剪藏按钮
  ▼
extractTopic() 提取 作者/时间/正文/标签/评论/外链
  │  若正文含外链
  ▼
background.js 开后台 tab 渲染 → 轮询等待内容 → 提取 innerHTML
  ▼
htmlToMarkdown() 转正文  +  图片本地化(content.js fetch → base64)
  ▼
本地服务 127.0.0.1:8765
  /clip         存 Markdown
  /save-image   存图片
```

## 安装

### 1. 加载扩展

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点「加载已解压的扩展程序」,选择本仓库目录

### 2. 启动本地服务

```bash
node server.js
# [剪藏服务] http://127.0.0.1:8765 → ~/zsxq-clips
```

### 3. 使用

1. 在 Chrome 登录知识星球,打开 `wx.zsxq.com`
2. 浏览帖子,点帖子上的「📋 剪藏」按钮
3. 文件保存到 `~/zsxq-clips/`

## 注意

- 只支持**单篇逐条剪藏**(逐个点按钮),不做批量
- 抓取外链正文依赖知识星球的登录态,需保持登录
- 外链页面是 SPA,后台 tab 最多等待 8 秒渲染
- 本地服务默认监听 `127.0.0.1:8765`,端口冲突时请同步修改 `server.js`、`content.js`(顶部 `IMG_SERVER`)、`background.js`(顶部 `SERVER`)

## 文件结构

```
├── manifest.json      # Chrome MV3 扩展配置
├── content.js         # 注入页面:提取帖子 + 图片本地化 + 触发保存
├── background.js      # Service Worker:抓取外链正文、代理本地服务
├── server.js          # 本地 HTTP 服务(/clip、/save-image)
└── icons/             # 扩展图标
```

## License

MIT
