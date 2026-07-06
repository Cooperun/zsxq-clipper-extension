# 知识星球 AI 精选 — 精炼迭代设计(展示 / 评论 / 三维度评分)

- 日期:2026-07-06
- 项目:zsxq-clipper
- 状态:已确认,待实现
- 前置:AI 精选筛选层已上线(plan `2026-06-16-zsxq-ai-curation.md` 已执行完毕)

## 1. 全文展示:悬浮框放大 + Markdown 渲染

**痛点**:当前 📄 全文是卡片内 240px 滚动纯文本,太小且不渲染格式。

**方案**:
- 点 📄 全文 → 悬浮框临时放大(`width: 600px; max-height: 90vh`,居中保持),正文 `mdToHtml(text)` 渲染后注入
- `mdToHtml` 支持:标题 `#/##/###`、无序列表 `-/*`、有序列表 `1.`、代码块 ` ``` `、行内代码 `` ` ``、图片 `![](url)` → `<img>`、链接 `[](url)` → `<a target=_blank>`、加粗 `**`、引用 `>`
- 图片 `<img style="max-width:100%">` 内联显示
- 右上「收起」按钮 → 悬浮框回原尺寸(320px)
- 放大时正文区独立滚动;XSS 安全:mdToHtml 输出经 `escHtml` 转义正文文本,只保留受控 md 标签

**文件**:`content.js`(加 `mdToHtml` + 放大/收起 toggle)。

**取舍**:自写轻量 mdToHtml(zsxq 正文格式简单,不引 marked.js 增加依赖)。覆盖常见 md 元素即可。

## 2. 评论纳入评分

**痛点**:提问帖的价值在评论,但当前 AI 只看 `talk.text`。

**方案**:
- `lib/zsxq-api.mjs` 加 `fetchComments({ groupId, topicId, fetch, count })` → `[{ text, owner, likes }]`
  - 端点 `GET /v2/groups/<gid>/topics/<tid>/comments`(**实现时实测**:字段/分页/认证,与 topics 同 cookie 认证)
- background `handleScanToday`:对候选帖(粗筛后,limit 50 内)拉评论,top3(按 likes)拼入 `scoreOne` 输入
  - 输入格式:`正文:...\n\n精选评论:\n- 评论1(赞N)\n- 评论2\n- 评论3`
- 每候选 +1 次 comments API 调用(候选已粗筛至几十条,成本可接受)

**文件**:`lib/zsxq-api.mjs`(+`fetchComments`)+ `tests/zsxq-api.test.mjs`(+ 测试)+ `background.js`(编排:拉评论 → 拼入 → 评分)。

**取舍**:comments 拼入 `text`(不改 `buildPrompt` 签名,最小改动)。

## 3. 三维度评分(本地算 + AI 评)

**痛点**:当前单一"有用程度",无新鲜度/重复考量。

**维度**:
- **(a) 新鲜度 freshness(本地)**:`computeFreshness(create_time_iso) = max(0, 1 - daysOld/30)`。今天=1,30天=0,>30天=0
- **(b) 重复 novelty(本地)**:`computeNovelty(topic, history) = 1 - maxOverlap`
  - 重叠率 = 标题关键词 Jaccard × 0.6 + 正文前 200 字 Jaccard × 0.4(中文按字/词切分)
  - history 为空 → novelty = 1(无重复信号不惩罚)
- **(c) 实用度 utility(AI)**:现有 `scoreOne`,输入含评论,返回 1-10

**合成**:
- `score = round((freshness×0.2 + novelty×0.3 + (utility/10)×0.5) × 10)` → 1-10
- 权重:**freshness 0.2 / novelty 0.3 / utility 0.5**(utility 为主,重复次之,新鲜度辅)

**卡片显示**:总分 ⭐ + 半透明小标签 `F0.8 N0.9 U9`(三维度原值,F/N 是 0-1 一位小数,U 是 1-10 整数)。

**文件**:`lib/scorer.mjs`(+`computeFreshness`、`computeNovelty`)+ `tests/scorer.test.mjs`(+ 测试)+ `background.js`(编排三维度 + 合成)+ `content.js`(卡片渲染 F/N/U)。

## 4. .archived 历史读取(支撑 novelty)

**方案**:
- `content.js` `scanToday` 时,用 FS Access 句柄(`getClipDir`)读 `~/zsxq-clips/.archived/*.md`
- 每帖提取:标题(文件名去 `YYYY-MM-DD_zsxq_` 前缀)+ 正文前 200 字(去 frontmatter `---...---`)
- → `history[] = [{ title, textPrefix }]`
- 消息 `scanToday` 携带 `history` 给 background

**边界**:
- 句柄未授权 / .archived 为空 / 读取失败 → `history=[]`,novelty 降级 = 1(不阻断)
- 读 .archived 增加扫描前少量延迟(当前 14 帖,<200ms,可接受)

**文件**:`content.js`(读 .archived + 传 history)+ `background.js`(用 history 算 novelty)。

## 测试策略

- **lib/scorer**:`computeFreshness` 边界(今天=1、15天=0.5、30天=0、>30天=0);`computeNovelty`(history 空=1、与某历史帖标题全相同→低、完全不同→接近 1)
- **lib/zsxq-api**:`fetchComments`(mock fetch,验证 URL/cookie/字段映射)
- **集成**:端到端(重载扩展 + 扫描近 7 天 + 看 F/N/U + 点全文放大渲染)

## 未决 / 风险

1. **评论 API 端点待实测**(字段/分页)—— 与之前 topics API 同样先探查再写代码,Task 1 性质
2. **相似度算法简单**(Jaccard)—— 同主题不同角度可能误判为重复。初版可接受,后续可升级 SimHash
3. **读 .archived 延迟** —— 当前 14 帖可忽略;若未来量大,可缓存 history 到 chrome.storage
4. **md 渲染自写** —— 可能漏罕见格式;初版覆盖常见(zsxq 正文主要是纯文本 + 简单 md)
