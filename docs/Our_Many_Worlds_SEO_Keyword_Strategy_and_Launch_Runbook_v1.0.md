# Our Many Worlds SEO 关键词策略、技术实现与上线 Runbook v1.0

- 制定日期：2026-08-07
- 基线分支：`main`
- 基线提交：`dc4a7cd10978fc3662edcb6f2cf3445c1393ddb0`
- 实施分支：`feat/launch-seo-foundation`
- 生产主域：`https://ourmanyworlds.com`
- 产品：Our Many Worlds

---

## 1. 目标与边界

本轮目标不是承诺“提交代码后立即排到第一”，而是完成上线前必须具备的 SEO 基础，使搜索引擎能够：

1. 找到网站；
2. 正确识别唯一规范网址；
3. 在不依赖客户端 JavaScript 的情况下理解核心产品；
4. 区分首页、世界大厅、凯撒世界、桑田诏世界和 World Credits 页面；
5. 不收录登录、账户、房间、游戏过程、支付状态等低价值或私密页面；
6. 将 Our Many Worlds 与常见的“AI Dungeon / AI text RPG / AI Game Master”产品区分开。

本轮不包含：

- 购买外链；
- 批量生成低质量文章；
- 伪造评分、评论或玩家数量；
- 对搜索排名作不现实保证；
- 直接修改、合并或部署 `main`。

---

## 2. 搜索可见性基线

2026-08-07 使用以下查询进行公开搜索检查：

- `"Our Many Worlds" game`
- `site:ourmanyworlds.com`
- `"ourmanyworlds.com"`
- 当前首页品牌标题与描述的精确匹配查询

本次检查中，Our Many Worlds 没有出现在返回的搜索结果里。该结果不能证明所有搜索引擎、国家和数据中心都完全没有收录，但足以说明当前公开可发现性非常弱，不能依赖用户自然搜索找到产品。

### 2.1 代码层面的主要原因

原始实现存在以下 SEO 阻断或弱项：

| 问题 | 影响 |
|---|---|
| 首页初始 HTML 只有 loading 状态，核心内容由 JavaScript 注入 | 搜索引擎和非 Google 爬虫可能看到很少内容 |
| `/` 临时跳转到 `/home` | 首页规范网址信号分散，易形成重复 URL |
| 首页标题和描述过于品牌化、缺少类别搜索词 | 用户搜索 `AI multiplayer story game` 时相关性弱 |
| `/worlds/caesar` 与 `/worlds/sangtian` 共用通用 `platform.html` | 两个世界没有独立标题、描述、正文和结构化数据 |
| 没有 `robots.txt` 与 `sitemap.xml` | 新站发现和抓取效率较低 |
| 没有 canonical、Open Graph、Twitter Card | 规范化和社交分享信息不完整 |
| 没有结构化数据 | 搜索引擎难以明确识别网站、游戏、FAQ 和世界集合 |
| 游戏、账户、房间和状态页可被抓取 | 可能产生低质量、重复或私密页面索引 |
| 世界大厅完全依赖 World API 客户端渲染 | 初次抓取时可能没有可跟踪的世界链接 |

---

## 3. 竞品关键词研究

### 3.1 竞品公开页面使用的语言

| 产品 | 公开页面主语言 | 主要搜索词方向 |
|---|---|---|
| Friends & Fables | Create & Play AI RPGs、AI Game Master、World Building Tools、Multiplayer | AI RPG、AI Game Master、TTRPG、multiplayer |
| FableAI | AI Text RPG with Memory & Multiplayer Co-Op | AI text RPG、memory、multiplayer co-op、adventures |
| Runebook | AI Story Game Where You’re the Main Character | AI story game、main character、solo、friends、persistent consequences |
| Tales & Conquest | AI-Powered RPG、AI Game Master、Solo and Multiplayer Campaigns | AI-powered RPG、AI Game Master、persistent campaign |
| Storycraft | Craft & Play Any Story with AI、mobile multiplayer simulation game | AI story creation、multiplayer simulation、world building |

公开来源：

- https://fables.gg/
- https://www.fableai.app/
- https://runebook.gg/
- https://talesgame.com/
- https://www.storycraft.gg/

### 3.2 竞品共同占据的语义区

竞品大多围绕以下概念竞争：

```text
AI RPG
AI text RPG
AI Game Master
D&D / TTRPG
infinite stories
memory
world building
co-op campaign
```

这些词有用户认知，但竞争激烈，而且不能完整表达 Our Many Worlds 的核心：

- 玩家不是一个队伍共同控制一条故事线；
- 不同角色有不同目标、秘密和有限视角；
- 玩家之间存在交涉、判断、隐瞒、承诺和筹码；
- 一个人的行动会改变其他玩家接下来能看见、相信和执行的事情；
- AI 的首要职责是统一裁决共享世界，而不只是续写文本。

---

## 4. 独特 SEO 定位

### 4.1 应占据的类别名称

主类别描述：

> **AI shared-world social strategy game**

用户可理解版本：

> **An AI multiplayer story game where every role has different goals and secrets, but everyone changes the same world.**

### 4.2 核心差异句

```text
Different goals. Different secrets. One shared world.
```

```text
Everyone sees a different truth. Everyone changes the same world.
```

```text
Your decisions do not stay in your story. They change what other players can do.
```

### 4.3 不能使用的错误定位

不要把产品长期描述成：

- AI writing tool；
- multiplayer chatbot；
- unlimited AI fiction generator；
- one more AI Dungeon clone；
- pure visual novel；
- simple choose-your-own-adventure。

这些定位会吸引错误用户，也会削弱产品最独特的“不同角色、私密目标、共享因果”特征。

---

## 5. 关键词体系

关键词不是在一个 `meta keywords` 标签里堆积，而是需要自然地分配到不同页面的标题、H1、正文、内部链接、图片说明和未来内容页中。

### 5.1 品牌词

| 关键词 | 目标 URL | 意图 |
|---|---|---|
| Our Many Worlds | `/` | 品牌 |
| Our Many Worlds game | `/` | 品牌 + 产品 |
| Our Many Worlds AI game | `/` | 品牌 + 类别 |
| ourmanyworlds | `/` | 导航 |

### 5.2 一级类别词

| 关键词 | 目标 URL | 优先级 |
|---|---|---:|
| AI multiplayer story game | `/` | P0 |
| multiplayer interactive story game | `/` | P0 |
| AI roleplay game with friends | `/` | P0 |
| AI social strategy game | `/` | P0 |
| online story game with friends | `/` | P1 |
| shared world AI game | `/` | P1 |
| multiplayer narrative game | `/` | P1 |

### 5.3 机制差异词

| 关键词 | 目标 URL | 用途 |
|---|---|---|
| private role story game | `/` | 私密身份与视角 |
| asymmetric information story game | `/` | 信息不对称 |
| secret role narrative game | `/` | 目标与秘密 |
| AI game with different player perspectives | `/` | 多视角 |
| choices affect other players game | `/` | 跨玩家因果 |
| social deduction story game | 未来玩法说明页 | 相邻用户意图，不应在首页过度使用 |

### 5.4 游玩方式词

| 关键词 | 目标 URL |
|---|---|
| solo AI story game | `/worlds` |
| multiplayer story game browser | `/worlds` |
| AI story game for groups | `/worlds` |
| cooperative AI story game | `/worlds` |
| roleplay game for friends online | `/worlds` |

### 5.5 世界专属词

#### Caesar

| 关键词 | 目标 URL |
|---|---|
| Caesar historical AI roleplay game | `/worlds/caesar` |
| Julius Caesar interactive story game | `/worlds/caesar` |
| Rome 44 BC roleplay game | `/worlds/caesar` |
| play as Brutus AI game | `/worlds/caesar` |
| change Caesar's fate game | `/worlds/caesar` |

#### Sangtian

| 关键词 | 目标 URL |
|---|---|
| Ming China historical strategy game | `/worlds/sangtian` |
| Jiajing fiscal crisis game | `/worlds/sangtian` |
| historical political roleplay game | `/worlds/sangtian` |
| Chinese history interactive story game | `/worlds/sangtian` |

---

## 6. 页面关键词映射与已实施标题

| URL | 搜索意图 | Title |
|---|---|---|
| `/` | 产品类别与品牌 | `AI Multiplayer Story Game with Private Roles | Our Many Worlds` |
| `/worlds` | 浏览可玩世界 | `AI Story Worlds to Play Solo or Multiplayer | Our Many Worlds` |
| `/worlds/caesar` | 凯撒历史推演 | `Caesar Historical AI Roleplay Game | Our Many Worlds` |
| `/worlds/sangtian` | 明代政治推演 | `Ming China Historical Strategy Story Game | Our Many Worlds` |
| `/credits` | 价格与 Credits | `World Credits and Pricing | Our Many Worlds` |

每个页面拥有独立：

- `<title>`；
- meta description；
- canonical；
- Open Graph；
- Twitter Card；
- 可索引静态正文；
- 与页面一致的结构化数据。

---

## 7. 本轮技术实现

### 7.1 可抓取静态内容

首页和世界大厅不再以纯 loading HTML 作为初始文档。即使 JavaScript 尚未执行，爬虫仍可读到：

- 产品类别；
- 玩法差异；
- Solo / Multiplayer；
- 私密目标与秘密；
- 共享世界与跨玩家影响；
- 可跟踪的世界链接；
- FAQ。

客户端启动后仍使用现有产品页面，不重做整体 UI。

### 7.2 规范网址

- `/home` 和 `/home.html` 永久跳转到 `/`；
- `/worlds.html` 永久跳转到 `/worlds`；
- 世界模板文件永久跳转到世界规范 URL；
- `/` 直接 rewrite 到 `home.html`，不再产生 `/ → /home` 跳转；
- 所有公开营销页声明绝对 canonical URL。

### 7.3 世界独立落地页

为两个当前可玩世界提供独立静态模板：

- `worlds-caesar.html`；
- `worlds-sangtian.html`。

生产 URL 仍保持：

- `/worlds/caesar`；
- `/worlds/sangtian`。

现有 `platform.js` 继续负责真实交互，SEO 模板只提供正确的初始 HTML、metadata 和结构化数据，不改变游戏流程。

### 7.4 结构化数据

已加入：

- `Organization`；
- `WebSite`；
- `VideoGame`；
- `FAQPage`；
- `CollectionPage`；
- `ItemList`；
- `BreadcrumbList`。

没有伪造：

- `aggregateRating`；
- `ratingValue`；
- `reviewCount`；
- 玩家数量；
- 媒体奖项。

### 7.5 抓取控制

公开页面允许索引；以下页面通过 `X-Robots-Tag` 或 meta robots 阻止索引：

- 登录；
- 账户；
- 管理后台；
- 房间和邀请；
- 游戏过程和结果；
- 角色选择；
- 重置密码；
- 支付状态页；
- 未配置独立 SEO 的动态世界页。

### 7.6 站点发现文件

新增：

- `/robots.txt`；
- `/sitemap.xml`；
- `/llms.txt`。

`llms.txt` 是辅助机器理解的公开说明，不是搜索排名保证，也不能替代 sitemap、HTML 内容和外部引用。

---

## 8. 上线后必须执行的操作

代码合并和生产部署完成后，按顺序执行。

### 8.1 生产检查

逐一验证：

```text
https://ourmanyworlds.com/
https://ourmanyworlds.com/worlds
https://ourmanyworlds.com/worlds/caesar
https://ourmanyworlds.com/worlds/sangtian
https://ourmanyworlds.com/credits
https://ourmanyworlds.com/robots.txt
https://ourmanyworlds.com/sitemap.xml
```

每个公开页面必须：

- 返回 200；
- 页面源代码内存在 title、description 和 canonical；
- canonical 与当前规范 URL 完全一致；
- 不带 `noindex`；
- Open Graph 图片返回 200；
- 页面在关闭 JavaScript 时仍能看到核心说明和链接。

每个私密页面必须：

- 返回正确业务页面；
- 响应头含 `X-Robots-Tag: noindex, nofollow, noarchive`，或 HTML 含同等 meta robots。

### 8.2 统一主域

在 Cloudflare / Vercel 中只保留一个主域版本：

```text
https://ourmanyworlds.com
```

如果 `www.ourmanyworlds.com` 可访问，应使用永久 301 跳转到主域。HTTP 应永久跳转到 HTTPS。不要让以下版本同时返回 200：

```text
http://ourmanyworlds.com
https://www.ourmanyworlds.com
https://ourmanyworlds.com/home
https://ourmanyworlds.com/home.html
```

### 8.3 Google Search Console

1. 创建 `ourmanyworlds.com` Domain Property；
2. 通过 DNS 验证；
3. 提交 `https://ourmanyworlds.com/sitemap.xml`；
4. 使用 URL Inspection 检查并请求索引：
   - `/`；
   - `/worlds`；
   - `/worlds/caesar`；
   - `/worlds/sangtian`；
5. 查看 Page Indexing、Crawl Stats、Core Web Vitals 和 Enhancements；
6. 一周后检查实际查询词与展示国家。

### 8.4 Bing Webmaster Tools

1. 导入 Google Search Console 站点或单独验证；
2. 提交同一 sitemap；
3. 检查 URL 和抓取错误；
4. 可在站点稳定后配置 IndexNow，但不能用它替代高质量页面。

### 8.5 结构化数据验证

使用：

- Google Rich Results Test；
- Schema.org Validator。

结构化数据通过验证并不保证展示富媒体结果；它的作用首先是帮助搜索引擎正确理解实体和页面关系。

---

## 9. 30 / 60 / 90 天内容计划

技术 SEO 只能让搜索引擎看见和理解网站。要获得非品牌关键词排名，还需要持续积累真正回答用户问题的页面、外部提及和真实使用信号。

### 9.1 上线后 30 天

优先发布 4 个高质量解释页：

1. `/how-it-plays`
   - 解释不同角色、私密信息、交谈、调查、筹码、主动谋划和统一结算；
2. `/guides/ai-multiplayer-story-game`
   - 回答此类游戏是什么、如何开始、与普通互动小说有何不同；
3. `/guides/ai-roleplay-game-with-friends`
   - 回答人数、房间、AI 补位、信息可见性和每局时长；
4. `/guides/solo-vs-multiplayer-ai-story-games`
   - 解释 Solo 与 Multiplayer 的真实体验差异。

要求：

- 每页只解决一个明确搜索意图；
- 使用真实产品截图；
- 有可跟踪的内部链接到世界和开始游玩；
- 不批量复制同一段 AI 文案；
- 不写尚未实现的功能。

### 9.2 上线后 60 天

扩充世界长尾页：

- `/worlds/caesar/roles/brutus`；
- `/worlds/caesar/roles/cassius`；
- `/worlds/caesar/roles/antony`；
- `/worlds/sangtian/roles/zhejiang-governor`；
- 世界玩法示例与非剧透角色说明；
- 每个世界的“如何游玩”“适合谁”“Solo 与多人差异”。

角色页不能泄露关键私密信息，只公开足以产生兴趣的身份冲突和命运问题。

### 9.3 上线后 90 天

根据 Search Console 实际查询决定扩展，不凭感觉批量写文章。

优先依据：

- 已有展示但点击率低的词：优化 title 和 description；
- 排名 8–30 的词：增强正文、内部链接和真实案例；
- 世界名称相关词：补充世界落地页；
- 用户反复搜索的问题：转成 FAQ、指南或视频文字稿；
- 宣传视频带来品牌搜索：创建与视频一一对应的落地页。

---

## 10. 外部发现与品牌信号

新站即使技术完整，也可能长时间没有排名。上线后需要建立真实、可验证的外部入口：

- YouTube 频道简介和每条视频描述统一链接到对应世界页；
- Discord、Reddit 和社区资料页使用同一品牌名与主域；
- 产品发布页、开发日志、创作者介绍和采访链接到规范 URL；
- 邀请测试玩家发布真实体验，不购买垃圾外链；
- 重要宣传视频提供网页文字稿，使视频内容也可被搜索。

品牌名称必须统一写为：

```text
Our Many Worlds
```

不要在外部同时使用多个产品名，例如 `AI Story Room`、`Many Worlds Game`、`OurManyWorlds AI` 作为主要品牌。

---

## 11. 衡量指标

### 11.1 第一阶段：被发现

- sitemap 成功读取；
- 5 个公开 URL 被抓取；
- 品牌词开始产生 impressions；
- `site:ourmanyworlds.com` 能看到规范页面；
- 没有账户、房间、游戏过程页进入索引。

### 11.2 第二阶段：被理解

- Google 查询中出现：
  - `our many worlds`；
  - `AI multiplayer story game`；
  - `AI roleplay game with friends`；
  - `Caesar historical roleplay game`；
- 世界页获得非品牌 impressions；
- 首页搜索摘要使用产品描述，而不是 loading 文案。

### 11.3 第三阶段：产生转化

建议在分析系统记录：

```text
organic_landing
view_world
start_solo
create_room
signup
credit_checkout_start
```

SEO 不能只看点击量，应看自然搜索用户是否真正进入世界、开始 Solo 或创建房间。

---

## 12. 现实预期

- 技术改动完成后，不会立刻自动排名第一；
- 新域名的首次抓取和索引可能需要数天到数周；
- 请求索引不保证立即收录；
- 品牌精确词通常最先建立可见性；
- `AI multiplayer story game` 等类别词需要内容、使用信号和外部引用逐步竞争；
- 本轮最重要的成果是消除“爬虫看不到、URL 信号混乱、页面都长得一样”的基础问题。

Google 官方参考：

- JavaScript 与动态渲染：https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering
- 规范化重复 URL：https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Sitemap：https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- 搜索摘要与 meta description：https://developers.google.com/search/docs/appearance/snippet
- 结构化数据：https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data

---

## 13. 验收标准

### 13.1 代码验收

- [ ] 首页拥有唯一 title、description、canonical、OG、Twitter Card；
- [ ] 首页初始 HTML 包含核心玩法内容；
- [ ] FAQ 可见内容与 FAQPage 结构化数据一致；
- [ ] `/worlds` 初始 HTML 有两个可跟踪的可玩世界链接；
- [ ] `/worlds/caesar` 与 `/worlds/sangtian` 有独立 HTML 和 metadata；
- [ ] `/` 不再跳转到 `/home`；
- [ ] `/home` 永久跳转到 `/`；
- [ ] sitemap 只包含公开规范页面；
- [ ] 私密与运行态页面 noindex；
- [ ] 没有伪造评分或评论；
- [ ] `node --check` 和 Web 测试通过。

### 13.2 上线验收

- [ ] 主域和 HTTPS 规范化；
- [ ] robots 与 sitemap 返回 200；
- [ ] Search Console 已验证；
- [ ] sitemap 已提交；
- [ ] 4 个核心 URL 已请求索引；
- [ ] 结构化数据无语法错误；
- [ ] 一周后有首轮索引与查询报告；
- [ ] 私密页面未被索引。
