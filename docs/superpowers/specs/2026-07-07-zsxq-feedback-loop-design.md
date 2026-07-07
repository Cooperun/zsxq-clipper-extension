# 知识星球 AI 精选 — 反馈迭代评分 + Token 用量记录

- 日期:2026-07-07
- 项目:zsxq-clipper
- 状态:已确认,待实现
- 前置:AI 精选 + 三维度评分 + 全文评论展示已上线(manifest 6.2.0)

## 目标

用户对 AI 评分给反馈(自己认为值几分 + 理由),反馈沉淀下来迭代评分口味:(B) 每次评分把最近纠偏项作 few-shot 注入 prompt;(C) 攒满 20 条自动用 LLM 综合成"评分指引" guidance,后续评分带上,且让旧 utility 缓存失效重评。附带轻量 token 用量记录与 7 日柱状图。

## 1. 数据模型(`chrome.storage.local`)

- **`feedback`**:数组,每条 `{ topic_id, title, textSnippet, aiScore, userScore, reason, ts }`。
  - `textSnippet`:正文前 80 字(给 few-shot 上下文,不含全文省 token)。
  - `aiScore`:用户给反馈时该帖的 AI 总分(留作纠偏参照)。
  - 上限 100 条,超出删最旧;**同 `topic_id` 覆盖旧的**(一帖只留最新一条)。
  - **"纠偏项"** = `|userScore - aiScore| >= 2`(B 取样用)。
- **`guidance`**:字符串,LLM 综合的口味指引,初始 `""`。
- **`guidanceVersion`**:数字,初始 0,每次 C 重生成 +1(进 cache key)。
- **`feedbackSeen`**:数字,上次触发 C 时的 `feedback.length`,初始 0(C 触发判定用)。
- **`tokenUsage`**:对象 `{ "YYYY-MM-DD": { prompt, completion, total, calls } }`,>30 天的键自动剪枝。

## 2. 反馈收集 UI(content.js `renderCuration`)

- 每张卡片加 `[✎ 我评]` 小按钮(与 📋收 / 📄全文 同行)。
- 点击 → 卡内内联展开表单:1-10 分(下拉 `<select>`)+ 一行理由(`<input>)+ `[保存]`。
- 保存:发 `addFeedback` 消息给 background(带 topic_id/title/textSnippet/aiScore/userScore/reason)→ 表单收起,卡上显示 `✓ 你评 N`(小标记,已知评过)。
- 读取已评状态(仅卡片标记):content.js 直接 `chrome.storage.local.get('feedback')` 后按 `topic_id` find,评过的卡显示 `✓ 你评 N`(可再点改)。**写**操作走 `addFeedback` 消息(经 background 用 lib/feedback 的覆盖+上限逻辑,避免 content 里重写)。

## 3. B — few-shot 注入(`lib/ai-scorer.mjs buildPrompt`)

- `buildPrompt({ focus, text, feedback, guidance })` 在 system prompt 末尾追加(非空才加):
  - 若 `guidance`:`\n\n【评分指引】\n{guidance}`
  - 若有纠偏反馈:`\n\n【用户品味参考(最近纠偏,据此校准你的打分倾向)】\n` + 最近 5 条纠偏项,每条:`- 《{title}》正文:{textSnippet}… AI 给 {aiScore} 分,用户认为该 {userScore} 分,理由:{reason}`
- `scoreOne(topic, opts)` 签名扩为接收 `feedback` / `guidance`,透传给 buildPrompt。
- background `handleScanToday` 评分前读 `feedback` + `guidance` 传入。

## 4. C — 自动重生成指引(background)

- `handleScanToday` 开头(拉 topics 之前或之后、评分之前):读 `feedback.length` 与 `feedbackSeen`。若 `length - feedbackSeen >= 20`(且 `length >= 20`)→ 触发 regen。
- regen:调一次 LLM(复用 scoreOne 的 provider/apiKey/model/endpoint),prompt = 全部 feedback(标题+aiScore+userScore+reason)+"把这些纠偏综合成一段简洁的评分指引,提炼用户偏好的选题规律与加减分倾向,直接输出指引文本"。返回文本 trim 后存 `guidance`、`guidanceVersion++`、`feedbackSeen = length`。
- 新增 `lib/ai-scorer.mjs` `buildGuidancePrompt(feedback)` + `regenerateGuidance({feedback, ...opts})` 返回 `{ guidance, usage }`。
- 失败降级:regen 抛错不阻塞本次扫描(日志即可),`feedbackSeen` 不动,下次扫描再试。

## 5. 缓存交互(关键取舍)

- 现 utility cache key = `keyFor(topic)`(hash of text)+ date(见 lib/cache.mjs)。
- **cache key 拼上 `guidanceVersion`**:C 重生成后版本变 → 旧 utility 全部失效 → 后续扫描用新 guidance + 新 feedback few-shot **批量重评**。这实现了"周期性迭代"。
- **feedback 不进 cache key**(变化太频繁,否则命中率崩):故 B(few-shot)**只对未命中缓存的 topic 生效**(新帖 + guidance 更新后重评的帖)。已缓存老帖 utility 不变。token 与效果的合理折中。
- 实现:`keyFor(topic, guidanceVersion)` 或 cache.get/set 传入 guidanceVersion 拼接(具体由实现定,保持 cache.mjs 接口简洁)。

## 6. Token 用量记录(轻量)

- **采集**:OpenAI 兼容响应含 `usage: { prompt_tokens, completion_tokens, total_tokens }`。`scoreOne` 解析后连同分数返回 `usage`(无则 null);`regenerateGuidance` 同样返回 usage。
- background 每次 LLM 调用后,调 `recordTokens(storage, today, usage)` 累加当日 `prompt/completion/total/calls`。
- **展示**(content.js 设置面板):加 `📊 Token 用量(近 7 天)` 区块 —— 读 `tokenUsage`,渲染 7 根纯 CSS 柱子(`<div>` 高度 ∝ 当日 total / 近 7 日最大值),下方 `今日: {total} tokens / {calls} 次`。无图表库。
- 剪枝:`recordTokens` 写入时顺手删 >30 天的键。

## 文件改动

| 文件 | 改动 |
|------|------|
| `lib/feedback.mjs`(新) | `getFeedback/addFeedback/corrections/recordTokens/getTokenUsage/pruneOld` 纯函数,接收 storage 后端(仿 cache.mjs),TDD |
| `lib/ai-scorer.mjs` | `buildPrompt` 加 feedback/guidance 段;`scoreOne` 返回 usage、接收 feedback/guidance;新增 `buildGuidancePrompt` + `regenerateGuidance` |
| `lib/cache.mjs` | `keyFor` / get/set 纳入 guidanceVersion(让 guidance 更新失效旧 utility) |
| `background.js` | handleScanToday 读 feedback/guidance 传 scoreOne、记 token、自动 regen;新消息 `addFeedback`/`getFeedback`/`getTokenUsage` |
| `content.js` | 卡片 [✎ 我评] 表单 + 已评标记;设置面板 token 柱状图 |
| `tests/feedback.test.mjs`(新) | feedback 增删/上限/覆盖/纠偏筛选;token 累加/剪枝 |

## 测试策略

- **lib/feedback**:加/查/覆盖/上限淘汰;`corrections` 取 `|userScore-aiScore|>=2` 最近 5;`recordTokens` 累加 + 当日覆盖 + >30天剪枝。mock storage 后端。
- **lib/ai-scorer**:buildPrompt 含 guidance/feedback 段(断言字符串);scoreOne 返回 usage(mock fetch 返回 usage);buildGuidancePrompt 含全部 feedback。
- **lib/cache**:keyFor 含 guidanceVersion。
- **集成**:端到端 —— 给一条卡打分反馈 → 再扫描 → 该 topic 因 guidanceVersion 没变仍命中缓存(B 不改老帖);触发 regen(凑 20 条)→ guidance 非空 → 下次扫描 cache 失效重评;设置面板柱状图渲染。

## 未决 / 风险

1. **OpenAI 兼容 usage 字段**:智谱 paas v4 / DeepSeek 均返回 `usage`;若某 provider 不返回,usage=null,跳过记录(不影响评分)。
2. **regen 的 LLM 输出不可控**:可能返回废话。初版直接 trim 存;后续可加"指引不超过 200 字"约束 + 失败回滚(版本不变)。
3. **B 只对新评生效**(已缓存老帖不变)—— 是 token 取舍,符合"逐步迭代"预期;若要立刻全量重评,可手动清缓存(暂不做)。
4. **feedback 文本进 prompt**:textSnippet 限 80 字 + 仅 5 条,单次评分增量 <几百 token,可控。
5. **token 柱状图精度**:仅记录 LLM 调用 token,不含 zsxq API(免费、不计)。柱状图按日聚合,calls 是调用次数。
