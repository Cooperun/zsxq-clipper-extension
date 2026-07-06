# 知识星球 API 实测参考

> 2026-06-17 在登录态页面用 Chrome DevTools 实测。后续所有 fetch 代码以此为准。
> 端点域 `https://api.zsxq.com`,与网页 `wx.zsxq.com` 同属 zsxq.com。

## 1. 认证

- **纯 httpOnly cookie**:`fetch(url, { credentials: 'include' })`,浏览器自动附加登录 cookie。
- **不需要** Authorization header、不需要 token、不需要签名(网页版 wx.zsxq.com 即此机制)。
- 扩展需 `host_permissions: *://*.zsxq.com/*`(manifest 已具备)。
- **background service worker 调用**:同样 `credentials:'include'` + host permission,走浏览器 cookie jar,会带上该域 httpOnly cookie。若实测发现 SW 拿不到 cookie,降级为在 content.js(page context)发起 fetch 再传给 background 评分。

## 2. 端点

`GET /v2/groups/{group_id}/topics`

`group_id` 从页面 URL 取:`wx.zsxq.com/group/<group_id>`(正则 `/group\/(\d+)/`)。

## 3. Query 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `scope` | 是 | 取 **`all`**。旧值 `by_create_time` 已废弃(返回 19301「无效的scope值」);`by_group` 返回 1059;`by_my_groups` 返回 19301 |
| `count` | 是 | 每页条数。缺省返回 14001「无效的count」 |
| `end_time` | 否 | 翻页游标,值为某条 topic 的 `create_time`(ISO 字符串)。返回 `create_time <= end_time` 的帖子(**闭区间,会与上一页最后一条重叠**) |

排序:`scope=all` 默认按 `create_time` 倒序(最新在前)。

## 4. 分页(拉"今日全部")

1. 首次不传 `end_time` → 取最新一页(`count` 条)
2. 取该页最后一条的 `create_time`,令 `end_time = ISO(其毫秒值 - 1)`(减 1ms 避免与上一页重叠)
3. 重复,直到:返回 `< count`(不满一页 = 到底),或某条 `create_time` 的日期 ≠ 今日(已翻到昨天)
4. `resp_data` **未观察到 `has_more` 字段**,靠返回条数判定翻页终止

> `create_time` 是 ISO 带时区字符串,`new Date(create_time)` 可直接解析;「减 1ms」:`new Date(new Date(iso).getTime() - 1).toISOString()`。

## 5. 响应结构

顶层:`{ succeeded, code, info, resp_data, error }`
- 成功:`succeeded === true`,`code === 0`,`resp_data.topics[]`
- 失败:`succeeded === false`,`code` = 错误码,`error` = 中文信息

## 6. topic 字段(`resp_data.topics[]`)

| 字段 | 类型 | 说明 |
|------|------|------|
| `topic_id` | number(int64) | 帖子 ID |
| `topic_uid` | string | |
| `group` | object | `{ group_id, name, type, background_url }` |
| `type` | string | `"talk"`(普通帖)/ `"q&a"`(问答)/ 其他 |
| `talk` | object | `{ owner, text, images? }` |
| `talk.owner` | object | `{ user_id, name, avatar_url, description, location }` |
| `talk.text` | string | 正文(纯文本,含 `\n`) |
| `talk.images` | array? | `[{ image_id, type, thumbnail{url}, large{url}, original{url} }]`(有图才有) |
| `likes_count` | number | **点赞数** |
| `comments_count` | number | **评论数** |
| `digested` | boolean | **是否精华** |
| `sticky` | boolean | 是否置顶 |
| `create_time` | string(ISO8601+时区) | 如 `"2026-06-16T23:54:57.185+0800"` |
| `modify_time` | string | |
| `title` | string | 标题(常为空,talk 类标题通常空) |
| `rewards_count` | number | 打赏数(可选质量信号) |
| `reading_count` | number | 阅读数(可选质量信号) |
| `readers_count` | number | 阅读人数 |

## 7. 质量信号可用字段

`likes_count`(点赞)、`comments_count`(评论)、`digested`(精华)、`rewards_count`(打赏)、`reading_count`(阅读) + 由 `talk.text` 推算的信息密度(字数/代码块数/链接数)。

## 8. 错误码

| code | 含义 |
|------|------|
| 0 | 成功 |
| 14001 | 无效的 count |
| 19301 | 无效的 scope 值 |
| 1059 | 内部错误 |
| 15403 | 主题已经被删除(也见于 topic_id 不精确/被截断时) |

## 9. 评论 API

`GET /v2/topics/{topic_id}/comments?count=N`

> ⚠️ **不带 group 前缀**。`/v2/groups/{group_id}/topics/{topic_id}/comments` 实测返回 **404**(HTML)。
> 正确路径是 `/v2/topics/{topic_id}/comments`(2026-07-06 实测确认)。

- **认证**:同上,httpOnly cookie(`credentials:'include'`)。
- **query**:`count`(每页条数,必填,缺省报错)。默认按时间顺序;`resp_data.index` 为分页游标(本扩展只用首页 top N,不翻页)。
- **`topic_id` 必须是精确字符串**(见第 10 段),否则报 15403「主题已经被删除」。

### 响应结构

顶层:`{ succeeded, resp_data: { comments[], index } }`

### comment 字段(`resp_data.comments[]`)

| 字段 | 类型 | 说明 |
|------|------|------|
| `comment_id` | number(int64) | 评论 ID(大整数,见第 10 段) |
| `create_time` | string(ISO) | |
| `owner` | object | `{ user_id, name, avatar_url, location }` |
| `text` | string | **评论正文** |
| `likes_count` | number | **点赞数**(评分用) |
| `rewards_count` | number | 打赏数 |
| `replies_count` | number | 回复数 |
| `replied_comments` | array | 嵌套回复(本扩展不展开) |
| `group_owner_liked` | boolean | 星主点赞 |
| `topic_owner_liked` | boolean | 楼主点赞 |
| `sticky` | boolean | 是否置顶 |

本扩展 `mapComment` 取 `{ text, owner: owner.name, likes: likes_count }`,按 `likes` 降序取 top3 拼入 AI 评分输入。

## 10. 大整数 ID 精度(重要)

zsxq 的 `topic_id` / `comment_id` / `user_id` / `topic_uid` 是 int64,实测值在 **4.5×10¹⁶ 量级**,**超过 JS `Number.MAX_SAFE_INTEGER`(2^53 ≈ 9.0×10¹⁵)**。

直接 `await resp.json()` 会**截断**这些 ID(末几位变 0/错),导致:
- 用截断后的 id 调 `/v2/topics/{topic_id}/comments` → 报 15403「主题已经被删除」(id 对不上)。

**正确做法**:拿到响应 **raw text** 后,先用正则把这些 ID 字段**加引号转成字符串**再 `JSON.parse`:

```javascript
function parseZsxqJson(text) {
  // 把大整数 ID 字段先转字符串,避免 JSON.parse 丢精度
  const safe = text.replace(/"(topic_id|topic_uid|comment_id|user_id)"\s*:\s*(\d+)/g, '"$1":"$2"');
  return JSON.parse(safe);
}
```

`fetchToday` 与 `fetchComments` 都必须走 `parseZsxqJson(await resp.text())`,不得直接 `resp.json()`。
> 正则只匹配 JSON 键值结构(`"key":<digits>`),不会误伤字符串值里的字面量(那里的引号会被转义为 `\"`)。

