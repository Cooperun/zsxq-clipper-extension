# 知识星球剪藏 (zsxq-clipper)

一个 Chrome 扩展,在知识星球(`wx.zsxq.com`)帖子上添加「剪藏」按钮,一键把帖子保存为本地 Markdown 文件,支持抓取文章外链正文与图片本地化。新增 **AI 精选筛选层**:拉取星球今日全部帖子,用质量信号粗筛 + 智谱 GLM 逐条评分,侧栏只展示高分帖,一键收藏。

## 功能

- ⭐ **AI 精选**:今日帖子自动评分排序,只看高分内容(进阶用法,见下)
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

## 进阶:AI 精选筛选层

在逐篇剪藏之外,本扩展可拉取今日星球全部帖子,先做质量信号粗筛,再用**智谱 GLM** 逐条打分,只在右侧「⭐ AI 精选」栏展示高分帖,一键收藏。

### 配置(扩展选项页)

打开 Chrome 扩展管理页(`chrome://extensions/`)→ 找到本扩展 → 点「详情」→「扩展选项」(即 `options.html`),填入:

- **智谱 GLM API Key**:去 [智谱开放平台](https://open.bigmodel.cn/) 申请,填自己的 key
- **模型**:默认 `glm-4-flash`,可换其他 GLM 模型
- **我关注的领域**:一段话,作为 AI 评分参考(例如「AI 编程、独立开发、RAG」)

### 用法

1. 打开知识星球(`wx.zsxq.com`),进入某个星球
2. 页面右侧出现「⭐ AI 精选」栏,点「🔍 扫描今日」
3. 扩展自动拉取今日全部帖子(质量信号粗筛 + GLM 逐条评分),高分帖按分数排序列在侧栏
4. 看到中意的,点该条「📋 收」即可收藏落盘

### 首次授权

首次点收藏/剪藏时,浏览器会请求授权目录,选择你的 `~/zsxq-clips/`(知识星球剪藏入库目录)。File System Access API 会持久化目录句柄,但**浏览器重启后首次写入需再点一次「允许访问」**(浏览器安全限制)。

### 落盘

- 通过 **File System Access API** 直接写 `~/zsxq-clips/`(顶层=待入库,衔接你的 wiki 入库流程)
- 图片存到 `assets/<slug>/`,Markdown 中图片链接替换为本地相对路径
- 本地服务(`server.js`,端口 `8765`)现为**可选 fallback**,默认不依赖

### 安全

- GLM API Key 存在 `chrome.storage.local`,**仅本机**,不上传、不外发
- 源码**不硬编码任何 key**(项目已开源),每个使用者填自己的 key
- 拉取星球帖子复用浏览器的知识星球登录态(cookie),不另外存储账号密码

## 注意

- 单篇剪藏逐个点按钮;**AI 精选**可批量拉取今日帖并评分,但收藏仍需逐条点「📋 收」(不自动入库)
- 抓取外链正文、AI 精选拉取星球帖子,均依赖知识星球的登录态,需保持登录
- 外链页面是 SPA,后台 tab 最多等待 8 秒渲染
- 本地服务(`server.js`)默认监听 `127.0.0.1:8765`,现为可选 fallback;若启用且端口冲突,请同步修改 `server.js`、`content.js`(顶部 `IMG_SERVER`)、`background.js`(顶部 `SERVER`)

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
