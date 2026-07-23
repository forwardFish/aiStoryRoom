# Many Worlds 中英文并行开发与可切换运行实施方案 v1.0

> 项目：`aiStoryRoom`  
> 首个适配世界：`sangtian`  
> 当前开发主语言：简体中文（`zh-CN`）  
> 首发生产语言：英文（`en`）  
> 文档日期：2026-07-23  
> 状态：待实施

---

## 1. 文档目的

本方案解决的不是“把现有中文代码一次性改成英文”，而是建立两条可以长期并存的语言通道：

1. 当前中文开发、测试和剧情审校方式继续可用，默认行为尽量不变。
2. 英文页面、英文桑田诏内容、英文 DeepSeek Prompt、英文错误和兜底内容在独立语言目录中准备完成。
3. 开发者可以通过启动参数选择中文或英文，不需要手工替换文件，也不需要修改 Git 工作区。
4. 正式海外发布时只启用和打包英文，不向玩家暴露中文。
5. 后续增加日语、韩语等语言时复用同一套机制，不再复制业务逻辑。

本方案的核心原则是：

> 复制语言内容，不复制业务逻辑；共享稳定 ID、规则、数字、因果结构和素材路径。

---

## 2. 最终目标

### 2.1 中文开发模式

执行中文开发命令后：

- 现有中文页面可以继续运行。
- 桑田诏角色、地点、指标、剧情、决策和结局仍然使用中文。
- DeepSeek 使用中文 Prompt，并输出中文剧情。
- 现有中文剧情审校方式保持可用。
- 不要求为了查看中文而撤销英文代码或切换 Git 分支。

目标命令：

```bash
pnpm dev:zh
```

### 2.2 英文开发模式

执行英文开发命令后：

- 首页、房间、角色选择、主游戏页面全部使用英文。
- 桑田诏角色、官职、地点、指标和玩家可见故事内容使用英文。
- DeepSeek 使用英文 Prompt，并只生成英文玩家内容。
- 英文 API 响应、Toast、错误、空状态和兜底剧情不得泄漏汉字。
- 使用相同的 `sangtian`、`roleKey`、阶段 ID、行动 ID 和素材 ID。

目标命令：

```bash
pnpm dev:en
```

### 2.3 英文生产模式

正式海外发布时：

- 默认语言固定为 `en`。
- 支持语言列表只包含 `en`。
- 不显示语言选择器。
- Web 发布产物中发现产品中文时阻断构建。
- 英文 API 玩家响应中发现汉字时阻断响应或执行受控重试。
- 中文母稿、中文 Prompt 和中文配置仍保留在源码仓库中，但不会被复制到英文 Web 发布产物。

目标命令：

```bash
pnpm build:vercel:english-release
```

### 2.4 本项目唯一完成标准

本项目不能以“已经建立语言目录”“大部分页面已经翻译”或“英文构建成功”作为完成。

只有同时满足以下条件，整个多语言任务才允许标记为 `OK`：

1. 中文模式下，所有当前支持的产品页面均能正常打开、加载、交互和完成业务流程。
2. 中文模式下，桑田诏的页面、角色、剧情、决策、错误、结局和 DeepSeek 输出均按中文合同运行。
3. 英文模式下，同一组页面和同一组已启用功能均能正常打开、加载、交互和完成业务流程。
4. 英文模式下，所有玩家可见内容均为英文，不得出现未批准的汉字或中文 fallback。
5. 中英文使用相同稳定 ID、规则、数值、权限边界和因果结构。
6. 两种语言都必须通过真实浏览器用户路径，不接受只验证源码、HTTP 200、静态截图或单元测试。
7. 两种语言都必须完成真实 API、持久化和 DeepSeek 生成闭环。
8. 任一当前启用页面、状态、弹窗、Toast、错误分支或故事流程缺少语言覆盖，整体状态仍为 `INCOMPLETE`。

可以分阶段开发和报告进度，但不能分阶段降低最终完成标准。

---

## 3. 非目标

第一阶段明确不做以下事情：

- 不把现有中文文件永久覆盖成英文。
- 不重命名 `sangtian`、`roleKey`、阶段 ID、行动 ID、证据 ID 或素材 ID。
- 不复制两份业务服务、规则引擎或数据库模型。
- 不要求中文文档、测试说明、原著和 authoring 资产全部删除中文。
- 不允许正在进行的故事在中途直接从中文剧情切换成英文剧情。
- 不自动把旧中文存档翻译成英文存档。
- 不在两天版本中建设翻译后台、众包翻译流程或完整用户语言偏好系统。
- 不使用运行时“生成完中文再机器翻译成英文”的后处理方式作为主要路径。

最后一条非常重要。剧情生成后再翻译会破坏：

- 角色和地点术语一致性；
- 决策与因果字段的对应；
- 已批准事实与叙事文字的绑定；
- 校验器对模型输出的判断；
- 英文输出的自然程度。

英文模式应直接向 DeepSeek 提供英文语言合同，并要求它直接生成英文结构化结果。

---

## 4. 当前状态摘要

以下是实施前的当前状态，用于确定改造范围。

### 4.1 已经完成的低风险英文清理

- `/trio` 页面和部署残留已删除，访问返回 `404`。
- 房间页桑田诏世界名已改为英文。
- `api-story-storage.js` 的指定客户端错误已改为英文。
- 桑田诏图片 `alt` 已改为英文。
- 独立 HTML 页面的主要标题、描述、输入提示和无障碍文案已清理。
- 已有 Web 英文发布扫描：

```bash
pnpm scan:english-web
pnpm check:english-web-release
pnpm build:vercel:english-release
```

### 4.2 Web 当前剩余中文

当前 Web 产品源码扫描仍主要集中在：

- `apps/web/public/app.js`
- `apps/web/public/continuous-story-v2-legacy-storage.js`
- `apps/web/public/continuous-story-v2-view.js`
- `apps/web/public/main-game.css`

实施前扫描约有 229 处 Web 中文命中。这里既包括真正的中文玩家文案，也包括已经存在的中英文条件分支和少量中文 class。

### 4.3 桑田诏当前语言状态

`packages/templates/config/sangtian/game.json` 当前：

- `presentation.locale` 为 `zh-CN`；
- 世界角色、身份、目标、地点、指标和能力描述主要是中文；
- `/api/v4/worlds/sangtian` 当前会直接投影这些字段；
- 角色选择页因此仍会显示中文。

当前启用策略版本为：

```text
sangtian_v1_2
```

`sangtian_v1_1` 仍然是 published 历史版本，但不属于两天英文首发的优先翻译范围。

### 4.4 DeepSeek 与剧情运行时

当前至少存在两条需要区分的故事运行路径：

1. Solo Story Engine；
2. Continuous Story V2 / Multiplayer 路径。

当前中文 Prompt、中文输出校验、中文兜底叙事和中文关键词主要分布在：

- `apps/api/src/solo-story-engine/prompt-builder.ts`
- `apps/api/src/solo-story-engine/output-validator.ts`
- `apps/api/src/solo-story-engine/reference-binder.ts`
- `apps/api/src/solo-story-engine/context-compiler.ts`
- `apps/api/src/solo-story-engine/solo-story-engine.service.ts`
- `apps/api/src/continuous-story-v2/story-generation.pipeline.ts`
- `apps/api/src/continuous-story-v2/story-content.ts`
- `apps/api/src/continuous-story-v2/story-context.composer.ts`
- `apps/api/src/continuous-story-v2/player-intent.ts`
- `apps/api/src/continuous-story-v2/asset-language.ts`

英文适配不能只给 Prompt 加一句“请输出英文”。中文字符预算、中文禁用表达、中文事实匹配和中文兜底文本都必须有对应的英文语言包或英文校验策略。

---

## 5. 总体架构

系统分成四层：

```text
稳定业务层
    ↓
世界内容层
    ↓
语言内容层
    ↓
运行与发布选择层
```

### 5.1 稳定业务层

所有语言共用：

- `worldId`
- `templateId`
- `roleKey`
- `stageId`
- `decisionId`
- `assetKey`
- 规则数值
- 状态字段
- 权限边界
- 因果关系
- API code
- HTTP 状态
- 数据库主键
- 素材真实路径和 hash

这些内容不翻译，也不因语言不同而复制业务实现。

### 5.2 世界内容层

定义桑田诏的事实、规则和剧情结构，例如：

- 哪些角色存在；
- 哪些阶段存在；
- 哪些证据可以使用；
- 哪些决策内核可以开放；
- 哪些因果后果必须兑现；
- 哪些字段允许玩家看到。

这一层应尽量与语言无关。

### 5.3 语言内容层

每种语言提供：

- 页面文案；
- 世界标题和描述；
- 角色名、身份、目标和能力；
- 地点和指标标签；
- 阶段、剧情、选项和结局文本；
- API 可读错误；
- DeepSeek Prompt；
- 输出风格规则；
- 输出校验提示；
- 关键词和禁用表达；
- 兜底叙事。

### 5.4 运行与发布选择层

负责决定本次运行使用什么语言：

- 中文本地开发；
- 英文本地开发；
- 英文正式构建；
- 未来的用户语言选择；
- 故事创建时锁定内容语言。

---

## 6. 目录设计

### 6.1 Web 语言资源

Web 语言源文件不能全部放进 `apps/web/public`。当前 Web 构建会复制公共目录，如果中文语言包位于 `public` 中，英文发布扫描仍会发现中文。

建议新增：

```text
apps/web/locales/
├─ zh-CN/
│  └─ messages.json
└─ en/
   └─ messages.json
```

运行时只加载当前语言。英文正式构建只将英文消息写入部署产物。

建议新增运行时模块：

```text
apps/web/public/i18n-runtime.js
```

主要接口：

```js
t("room.join")
t("game.history")
t("game.decision.submit")
t("errors.storyUnavailable")
t("credits.decisionCost", { count: 1 })
```

`t()` 必须支持：

- 变量插值；
- 基本复数；
- 缺失键检测；
- 开发环境告警；
- 英文发布环境禁止回退到中文。

### 6.2 桑田诏语言资源

为减少第一阶段对现有中文运行的影响，当前中文 `game.json` 暂时保留。新增语言清单和独立语言目录：

```text
packages/templates/config/sangtian/
├─ game.json
├─ locale-manifest.json
└─ locales/
   ├─ zh-CN/
   │  ├─ game.copy.json
   │  ├─ story-package/
   │  └─ continuous-strategy-v1.2/
   └─ en/
      ├─ game.copy.json
      ├─ story-package/
      └─ continuous-strategy-v1.2/
```

第一阶段策略：

- `game.json` 继续作为现有中文兼容入口；
- `locales/zh-CN` 保存中文语言内容快照；
- `locales/en` 保存对应英文内容；
- 新 Loader 在指定 locale 时加载语言覆盖；
- 没指定 locale 的旧调用继续得到当前中文行为；
- 英文模式必须显式加载 `en`，不得静默回退到中文。

`locale-manifest.json` 示例：

```json
{
  "schemaVersion": "world_locale_manifest_v1",
  "worldId": "sangtian",
  "defaultDevelopmentLocale": "zh-CN",
  "supportedLocales": ["zh-CN", "en"],
  "locales": {
    "zh-CN": {
      "gameCopyPath": "locales/zh-CN/game.copy.json"
    },
    "en": {
      "gameCopyPath": "locales/en/game.copy.json"
    }
  }
}
```

### 6.3 API 通用消息

建议新增：

```text
apps/api/src/i18n/
├─ locale.ts
├─ translator.ts
├─ leak-guard.ts
└─ messages/
   ├─ zh-CN.ts
   └─ en.ts
```

API 业务代码继续使用稳定错误 code：

```ts
{
  code: "STORY_GENERATION_FAILED",
  message: t(locale, "errors.storyGenerationFailed")
}
```

不得翻译：

- `code`
- HTTP 状态
- JSON 字段名
- 内部枚举

只翻译玩家可读 `message`、`reason`、`suggestedRewrite` 等字段。

### 6.4 DeepSeek Prompt 与语言校验

建议新增：

```text
apps/api/src/solo-story-engine/locales/
├─ zh-CN/
│  ├─ prompt-policy.ts
│  ├─ validator-language.ts
│  ├─ fallback-copy.ts
│  └─ glossary.ts
└─ en/
   ├─ prompt-policy.ts
   ├─ validator-language.ts
   ├─ fallback-copy.ts
   └─ glossary.ts
```

Continuous Story V2 对应新增：

```text
apps/api/src/continuous-story-v2/locales/
├─ zh-CN/
│  ├─ generation-policy.ts
│  ├─ validator-language.ts
│  └─ fallback-copy.ts
└─ en/
   ├─ generation-policy.ts
   ├─ validator-language.ts
   └─ fallback-copy.ts
```

Prompt Builder 继续负责拼装结构，但语言内容来自当前 locale：

```ts
const policy = getSoloPromptPolicy(locale);
const glossary = getSangtianGlossary(locale);
```

不能复制两份 `SoloStoryEngineService`。只有 Prompt 内容、语言规则和兜底文字分语言。

---

## 7. 术语表

必须先建立人工批准的术语表。术语表是中英文一致性的权威来源，不允许不同页面各自临时翻译。

建议新增：

```text
packages/templates/config/sangtian/locales/glossary.json
```

示例结构：

```json
{
  "schemaVersion": "world_glossary_v1",
  "worldId": "sangtian",
  "terms": {
    "world.sangtian.title": {
      "zh-CN": "桑田诏：嘉靖财政危局",
      "en": "Sangtian Edict: The Jiajing Fiscal Crisis"
    },
    "role.zhejiang_governor": {
      "zh-CN": "浙江总督",
      "en": "Zhejiang Governor-General"
    },
    "role.zhejiang_xunfu": {
      "zh-CN": "浙江巡抚",
      "en": "Zhejiang Provincial Governor"
    },
    "place.governor_office": {
      "zh-CN": "杭州总督府 · 内厅",
      "en": "Governor-General's Residence, Hangzhou · Inner Hall"
    },
    "metric.treasury": {
      "zh-CN": "国库银两",
      "en": "Treasury Reserves"
    }
  }
}
```

术语表至少覆盖：

- 世界名；
- 六个角色名；
- 官职；
- 地点；
- 五个世界指标；
- 重要机构；
- 关键证据；
- 阶段标题；
- 常见行动；
- 结局等级；
- 品牌词 `World Credits`。

DeepSeek 英文 Prompt 必须包含压缩后的术语表，要求模型逐字使用批准译名。

---

## 8. Locale 解析规则

### 8.1 Locale 规范值

第一阶段只允许：

```text
zh-CN
en
```

内部统一规范化：

```text
zh、zh-cn、zh_CN → zh-CN
en-US、en-GB、en_US → en
```

### 8.2 开发环境优先级

建议优先级：

```text
故事已锁定 locale
    >
当前创建请求 locale
    >
AI_STORY_LOCALE 环境变量
    >
开发默认 zh-CN
```

可选开发查询参数：

```text
?locale=en
?locale=zh-CN
```

查询参数只用于本地和测试环境。英文生产不得允许使用查询参数绕过支持语言列表。

### 8.3 Web 与 API 必须一致

Web 不得自己决定 `en`，同时 API 仍按 `zh-CN` 运行。

建议由运行时配置提供统一值：

```json
{
  "defaultLocale": "zh-CN",
  "supportedLocales": ["zh-CN", "en"],
  "releaseLocale": null
}
```

英文生产：

```json
{
  "defaultLocale": "en",
  "supportedLocales": ["en"],
  "releaseLocale": "en"
}
```

---

## 9. 中文兼容要求

引入 i18n 后，当前中文模式必须保持：

- 页面主要文案不发生无意改写；
- 角色名和故事内容不发生无意变化；
- 现有 Prompt 的业务规则不丢失；
- 现有 API code 和结构不变化；
- 现有默认启动命令仍能运行；
- 没指定 locale 的旧测试仍按原预期运行。

具体做法：

1. 先把当前中文字符串原样复制到 `zh-CN` 语言包。
2. 修改调用点使用 `t()`，但默认 locale 仍为 `zh-CN`。
3. 运行中文回归测试并比较修改前后的玩家可见投影。
4. 中文回归通过后，再启用英文语言包。

不得在抽取中文字符串时顺便润色中文。语言抽取和内容改写必须分开，避免无法判断回归来自架构还是文案变化。

---

## 10. Web 页面实施方案

### 10.1 需要抽取的文案

包括：

- HTML `title`
- `meta description`
- 标题和正文
- 按钮
- 表单 `placeholder`
- `aria-label`
- 空状态
- Loading
- Toast
- 普通错误
- 历史记录
- 状态指标
- 决策区
- 主动谋划
- 关键事件
- 日终总结
- 最终结局
- World Credit 消耗说明

### 10.2 `app.js`

现有中英文三元表达式：

```js
en ? "History" : "历史回顾"
```

逐步改为：

```js
t("game.history")
```

动态内容：

```js
t("game.sceneNumber", { number: 2 })
t("game.worldCredits.cost", { count: 1 })
```

第一阶段允许业务结构仍在 `app.js` 中，但所有玩家可见固定字符串必须进入语言包。

### 10.3 旧兼容前端

`continuous-story-v2-legacy-storage.js` 仍可能为旧投影或兼容路径生成玩家内容，因此不能只处理当前主页面。

处理方式：

- 错误、标签、标题、默认文本进入 Web 语言包；
- 构造给 API 的行动文字时使用当前故事语言；
- 英文模式不得生成中文行动句子；
- 如果该路径在英文首发中不需要，必须明确禁用，而不是依赖“正常情况下不会调用”。

### 10.4 Web 语言包发布

中文语言源保存在 `apps/web/locales/zh-CN`，但英文发布只生成：

```text
apps/web/dist-vercel/__generated__/messages.json
```

内容来自：

```text
apps/web/locales/en/messages.json
```

发布脚本不得修改源文件。它只写入构建目录或受控生成目录。

---

## 11. 桑田诏配置实施方案

### 11.1 `game.json`

可本地化字段：

- `catalog.title`
- `catalog.subtitle`
- `catalog.description`
- `catalog.genre`
- `catalog.tags`
- `catalog.durationLabel`
- `catalog.lobby.*`
- `worldActor.actorName`
- `worldActor.description`
- `presentation.locationLabel`
- `presentation.roundLabel`
- `presentation.finaleLabel`
- `presentation.statusMetrics[*].label`
- `roles[*].roleName`
- `roles[*].identity`
- `roles[*].publicInfo`
- `roles[*].hiddenSecret`
- `roles[*].personalGoal`
- `roles[*].currentState`
- `roles[*].abilityText`
- `roles[*].arcText`
- `roles[*].knownInfo`
- `roles[*].cannotDo`
- `roles[*].gameplayProfile` 中所有玩家文案

不可本地化字段：

- `worldId`
- `publicId`
- `templateId`
- `roleKey`
- `actorKey`
- engine 版本
- strategy 版本
- fixed rules
- 图片路径
- 颜色
- 指标 key 和数值

### 11.2 `story-package`

英文模式需要对应英文内容：

- opening
- role ACL 的玩家可读部分
- cards
- mainline questions
- pressures
- floor obligations
- node scene labels
- directed beat copy
- part-one runtime 中进入 Prompt 或玩家输出的文字

以下标识保持一致：

- package ID 的逻辑主体；
- node ID；
- card ID；
- question ID；
- pressure ID；
- floor obligation ID；
- decision kernel ID；
- entity reference。

允许 locale 版本拥有不同内容 hash。Manifest 必须记录 locale，不能把英文文件伪装成中文 package 的同一个 hash。

### 11.3 `continuous-strategy-v1.2`

只优先适配当前启用版本：

- stages
- role-stage-content
- result-rules 中的玩家文案
- maneuver-strategies
- ending-rules
- reaction-scenarios
- agent-policies 中进入 Prompt 或玩家投影的文字
- system-actions 中玩家可见标签

`sangtian_v1_1` 暂时保留中文。英文模式如果遇到 v1.1 旧故事，应明确提示该旧故事暂不支持英文继续，而不是混合输出。

---

## 12. DeepSeek Prompt 实施方案

### 12.1 Prompt 结构不复制

以下逻辑共用：

- JSON Schema；
- 必填字段；
- allowed references；
- grounding ID；
- resolution ID；
- 决策数量；
- 因果提交；
- 重试流程；
- persistence；
- billing；
- idempotency。

分语言的是：

- system/developer 指令文字；
- 写作风格；
- 语言长度预算；
- 禁用表达；
- 角色、地点和机构译名；
- 示例；
- 玩家可读错误；
- 语言特定正则；
- fallback。

### 12.2 英文 Prompt 必须包含的合同

英文 Prompt 至少要求：

1. 所有玩家可见字段使用自然英文。
2. JSON 字段名和内部 ID 保持原协议。
3. 不输出汉字。
4. 使用批准术语表中的人物、官职、地点和机构名称。
5. 不把中文名与英文名同时并列输出。
6. 不翻译或改写稳定 ID。
7. 不发明中文上下文中不存在的新事实。
8. 决策必须是玩家可以立即执行的具体动作。
9. 不能把成功结果写进决策。
10. 不能替其他角色决定回应。

### 12.3 英文长度预算

当前 Prompt 中的“汉字数”要求不能直接用于英文。

应分别定义：

```ts
zh-CN: {
  resultNarrativeCharacters: { min: ..., max: ... },
  nextSituationCharacters: { min: ..., max: ... }
}

en: {
  resultNarrativeWords: { min: ..., max: ... },
  nextSituationWords: { min: ..., max: ... }
}
```

英文校验使用单词数或 Unicode 字符数，不把英文长度套入“汉字数”变量。

### 12.4 英文输出校验

英文输出至少检查：

- 是否包含汉字；
- 是否包含未翻译的批准术语；
- 是否出现未知 ID；
- 是否引用未提供人物或证据；
- 是否违反输出 Schema；
- 是否缺少两项合法决策；
- 是否提前宣布结果；
- 是否重复上一回合；
- 是否把内部报告写成玩家叙事。

中文输出继续使用现有中文关键词和中文叙事校验。两种语言不能共用同一套自然语言正则。

### 12.5 重试策略

英文输出第一次发现汉字：

1. 记录字段路径和泄漏片段；
2. 使用专门的英文修复 Prompt 重试一次；
3. 重试仍含中文则不得发布；
4. 返回统一英文可读错误；
5. 保留稳定 error code；
6. 不扣除一次失败生成对应的成功业务费用。

不得把未经验证的中英混合结果写入正式故事历史。

---

## 13. 中文泄漏防线

必须建立三道防线。

### 13.1 Web 构建扫描

现有脚本继续负责：

```text
apps/web/dist-vercel
```

英文发布模式发现产品中文则退出非零。

明确允许的例外：

- 图片真实源文件名中的日期；
- 不会展示的 hash；
- 已批准的内部测试 fixture。

例外必须通过结构化白名单实现，不得整体跳过某个大目录。

### 13.2 API 投影扫描

英文模式递归扫描玩家响应字段：

- world detail
- role detail
- game projection
- current turn
- decision options
- errors
- ending
- public messages
- AI narrative

内部 ID 和不可见调试字段可不扫描，但必须明确列出。

建议输出：

```text
ENGLISH_RESPONSE_HAN_LEAK
path=story.currentTurn.narrative
```

### 13.3 DeepSeek 输出扫描

模型 JSON 解析后、持久化前扫描所有玩家可见字符串。

顺序必须是：

```text
生成
→ JSON 解析
→ Schema 校验
→ grounding 校验
→ 语言校验
→ 持久化
→ 发布
```

语言校验失败的结果不能先写入故事，再尝试修复。

---

## 14. 故事语言与存档

### 14.1 必须区分界面语言和故事语言

```text
uiLocale
contentLocale
```

- `uiLocale`：按钮、导航、设置等界面语言；
- `contentLocale`：角色、剧情、决策、结局和 DeepSeek 输出语言。

界面语言未来可以随时切换。

故事语言在创建时锁定：

```text
StoryRun.contentLocale = en
```

### 14.2 第一阶段不做数据库迁移时

两天并行开发阶段可以先通过环境隔离：

```text
中文开发：AI_STORY_LOCALE=zh-CN
英文开发：AI_STORY_LOCALE=en
```

同时遵守：

- 切换语言后只创建新测试故事；
- 不恢复另一语言创建的旧故事；
- 中文和英文测试使用不同账号、不同 run namespace 或不同测试数据库；
- API 检测到当前 run 与环境语言不一致时拒绝继续。

### 14.3 正式开放多语言前

必须增加并持久化：

- `Room.locale`
- `StoryRun.locale`

旧记录迁移规则：

```text
现有记录默认标记为 zh-CN
```

多人房间：

- 房主创建房间时确定故事语言；
- 所有成员使用同一 `contentLocale`；
- 用户自己的 `uiLocale` 可以不同；
- AI 生成语言跟随房间 `contentLocale`。

---

## 15. 启动、切换与构建命令

计划新增：

```json
{
  "dev:zh": "node scripts/i18n/run-localized-dev.mjs zh-CN",
  "dev:en": "node scripts/i18n/run-localized-dev.mjs en",
  "build:web:zh": "node scripts/deploy/prepare-web-locale.mjs zh-CN && ...",
  "build:web:en": "node scripts/deploy/prepare-web-locale.mjs en && ...",
  "build:vercel:english-release": "... && pnpm check:english-web-release",
  "test:i18n": "node --test scripts/i18n/*.test.mjs",
  "check:i18n-parity": "node scripts/i18n/check-locale-parity.mjs",
  "check:english-api": "node scripts/i18n/check-english-api-fixtures.mjs"
}
```

`run-localized-dev.mjs` 负责在同一个跨平台 Node 启动器中设置：

```text
AI_STORY_LOCALE
SUPPORTED_LOCALES
```

然后启动现有的 API 和 Web 开发命令。这样不依赖 PowerShell、Bash 或 `cross-env` 的环境变量语法，也不会为了切换语言改写 `.env` 文件。

切换语言必须满足：

- 不修改源 JSON；
- 不复制覆盖现有中文文件；
- 不要求 Git reset；
- 不产生无法识别的工作区修改；
- 生成文件必须位于明确的构建目录并可重复生成。

---

## 16. 中英文一致性校验

新增：

```text
scripts/i18n/check-locale-parity.mjs
```

校验内容：

### 16.1 必须一致

- Schema version
- worldId
- roleKey 集合
- stageId 集合
- decisionId 集合
- nodeId 集合
- cardId 集合
- assetKey 集合
- 数组数量
- 规则数值
- 权限字段
- 状态 key
- 引用关系

### 16.2 允许不同

- title
- description
- label
- narrative
- prompt
- publicInfo
- personalGoal
- visibleTradeoff
- error message
- fallback copy
- locale-specific style budget

### 16.3 英文完整性

英文语言包：

- 不得缺少中文语言包已有的可翻译 key；
- 玩家可见值不得为空；
- 不得包含汉字；
- 不得出现未批准的角色译名；
- 不得使用数组索引代替稳定 ID 关联翻译。

---

## 17. 双语言完整测试与验收方案

### 17.1 测试目标

测试目标不是确认“翻译文件存在”，而是证明以下等价关系成立：

```text
中文运行路径的功能集合
    =
英文运行路径的功能集合
```

除产品明确批准的语言差异外，两种语言必须具备相同的：

- 路由；
- 页面状态；
- 操作按钮；
- API 能力；
- Solo 流程；
- Multiplayer 流程；
- Credits 流程；
- 错误处理；
- DeepSeek 生成流程；
- 持久化结果；
- 分享和恢复能力。

如果某项功能中文能用、英文不能用，或者英文能用、中文回归失败，则多语言任务不能验收。

### 17.2 路由清单必须自动生成

测试不能维护一份可能过期的手写页面清单。应新增路由清单生成器，同时读取：

- `apps/web/src/server.mjs`
- `vercel.json`
- 动态路由规则
- 独立 HTML 入口

生成当前产品路由 manifest。新增产品路由但没有双语言测试时，CI 必须失败。

当前至少包括：

| 路由 | 页面或业务 |
|---|---|
| `/`、`/home` | 首页 |
| `/privacy` | Privacy Policy |
| `/terms` | Terms of Service |
| `/refund` | Refund Policy |
| `/auth` | 登录与注册 |
| `/reset-password` | 重置密码 |
| `/account` | 账户与购买记录 |
| `/admin/refunds` | 退款管理 |
| `/worlds` | 世界列表 |
| `/worlds/:worldId` | 世界详情 |
| `/rooms` | 房间列表 |
| `/rooms/:roomId` | 房间大厅与角色状态 |
| `/join` | 邀请码加入 |
| `/role-select?story=:worldId` | Solo 角色选择 |
| `/game?runId=:runId` | 主游戏 |
| `/game/result?runId=:runId` | 游戏结果 |
| `/shared/result` | 公开分享结果 |
| `/credits` | Credits 钱包与购买确认 |
| `/credits/status` | 支付结果 |
| `/credits/cancel` | 支付取消 |
| `/credits/failed` | 支付失败 |

以下文件即使不是独立公开路由，也必须纳入语言扫描和渲染测试：

- `home.html`
- `worlds.html`
- `platform.html`
- `role-select.html`
- `index.html`
- `credits.html`
- `credits-success.html`
- `credits-status.html`
- `reset-password.html`
- `legal.html`
- 共享 Header、Dialog、Toast 和 Web Component。

### 17.3 页面状态矩阵

只测试页面首次打开不算完成。每个路由需要覆盖它真实存在的状态。

| 页面 | 必测状态 |
|---|---|
| 首页 | 未登录、已登录、世界加载中、世界加载失败、空列表、正常列表 |
| 登录/注册 | 登录、注册、校验失败、Google 不可用、忘记密码、重发验证、成功提示、服务错误 |
| 重置密码 | token 有效、token 无效、密码规则错误、成功 |
| Account | 加载中、正常资料、无购买记录、有购买记录、退款状态、未登录跳转、API 错误 |
| Worlds | 加载中、空列表、正常列表、API 错误、可玩与不可玩世界 |
| World Detail | Solo、Multiplayer、未登录、余额不足、世界不可用、加载失败 |
| Rooms | Open Rooms、My Rooms、筛选、空状态、加载失败、自动刷新、创建房间、加入码 |
| Room Detail | 等待玩家、选择角色、准备、倒计时、房主开始、Solo fallback、重连、房间失效、错误 |
| Role Select | 加载中、六角色、选择角色、取消选择、新建 run、恢复 run、API 错误、未登录 |
| Main Game | 开场生成、生成中、推荐决策、自定义决策、对话、调查、筹码、ActionGuard、Credits 锁、重试、恢复、阶段结束、最终结局、服务错误 |
| Game Result | 正常结果、无结果、未登录、分享、撤销分享、海报生成失败 |
| Shared Result | 有效链接、过期、撤销、无权限、不存在 |
| Credits | 钱包、套餐、确认、余额不足入口、支付成功、pending、cancel、failed、API 错误 |
| Legal | Privacy、Terms、Refund 三种正文和正确导航 |
| Admin Refunds | 未登录、无权限、空记录、正常记录、操作成功、操作失败 |

每个状态都必须检查：

- 页面是否正常渲染；
- 关键按钮是否存在且可点击；
- 导航是否正确；
- 异步加载是否结束；
- Toast、Dialog 和错误是否使用当前语言；
- 浏览器控制台是否出现未处理异常；
- 网络请求是否出现意外 `4xx/5xx`；
- DOM 是否出现未解析翻译 key；
- 当前语言是否意外回退到另一语言。

### 17.4 中文页面验收

中文模式执行：

```bash
pnpm dev:zh
```

必须验证：

- 路由 manifest 中每一个产品页面均能打开；
- 每一个页面状态的功能都能执行；
- 桑田诏世界、角色和故事内容为中文；
- DeepSeek 中文 Prompt 生效；
- DeepSeek 输出中文剧情和中文决策；
- 中文错误、Toast、空状态和 fallback 正常；
- 中文故事可以创建、继续、恢复并写入数据库；
- 中文 Credits 和分享流程不因 i18n 改造回归；
- 页面中不出现 `i18n.key.name`、空字符串或错误的英文 fallback。

中文模式允许保留以下批准英文词：

- 品牌名 `Our Many Worlds`；
- 品牌标语；
- `World Credits`；
- DeepSeek、Google 等产品名；
- 邮箱、URL、稳定 ID；
- WhatsApp、Telegram、Discord、Facebook、X 等平台名。

除此之外出现非预期英文 fallback 时必须记录为失败。中文扫描使用批准白名单，不能简单要求“页面完全没有英文字母”。

### 17.5 英文页面验收

英文模式执行：

```bash
pnpm dev:en
```

必须验证：

- 与中文模式相同的全部路由均能打开；
- 与中文模式相同的全部页面状态和操作均能执行；
- 所有玩家可见文字为英文；
- `title`、description、placeholder、aria-label、按钮、Toast、Dialog、Loading、空状态、错误均为英文；
- 桑田诏世界、六角色、官职、地点、指标和故事内容为英文；
- 分享海报中如果包含文字，文字也必须是英文；
- 英文模式不得静默加载 `zh-CN` 语言包；
- DOM、页面属性、浏览器对话框和 API 玩家响应不得出现汉字；
- 不得出现未解析翻译 key、空字符串或占位式机器翻译文本。

英文扫描不能只检查源码。必须检查：

1. 构建产物；
2. 浏览器渲染后的 DOM；
3. 动态弹窗和 Toast；
4. API 响应；
5. DeepSeek 输出；
6. 持久化后重新读取的故事；
7. 分享页和结果页。

### 17.6 响应式页面矩阵

所有核心页面至少在两个视口验证：

```text
Desktop: 1440 × 900
Mobile: 390 × 844
```

必须检查语言变长后的布局：

- 英文按钮是否溢出；
- 中文标题是否被截断；
- 角色卡高度是否异常；
- Dialog 是否超出屏幕；
- 状态指标是否换行破坏布局；
- 决策选项和错误提示是否可完整阅读；
- Header、Back、Credits 余额和语言标记是否重叠。

视觉检查不能替代功能检查，但布局破坏同样属于验收失败。

### 17.7 双语言 API 合同测试

同一个 API 用例分别运行 `zh-CN` 和 `en`。

至少覆盖：

```text
GET  /api/v4/worlds
GET  /api/v4/worlds/sangtian
GET  /api/v4/credits/balance
GET  /api/v4/rooms
POST /api/v4/rooms
POST /api/v4/rooms/join-by-code
GET  /api/v4/rooms/:id
POST /api/v4/rooms/solo
GET  主游戏投影
POST 推荐决策
POST 自定义决策
GET  下一回合投影
GET  最终结果
POST 创建分享
GET  公开分享
```

两种语言响应必须满足：

- JSON Schema 相同；
- error code 相同；
- HTTP 状态相同；
- stable ID 相同；
- 规则数值相同；
- 权限结果相同；
- 仅玩家可读文案和 locale 元数据不同。

英文响应递归扫描汉字。

中文响应检查未解析 key 和错误英文 fallback。

### 17.8 DeepSeek 双语言测试

DeepSeek 不能只测试一次开场。必须建立三层测试。

#### A. 确定性 Prompt 测试

对中英文分别断言：

- 选中了正确语言 Prompt；
- 使用了对应 glossary；
- 没有把中文长度预算用于英文；
- 输出 Schema 和 stable ID 合同不变；
- 英文 Prompt 包含 no-Han 约束；
- 中文 Prompt 保留现有历史语境和规则。

#### B. Fixture 生成与校验测试

中英文分别覆盖：

- 开场；
- 推荐决策；
- 自定义决策；
- 对话；
- 调查；
- 使用筹码；
- 玩家输入越权；
- 模型 Schema 错误；
- 未知 ID；
- 语言泄漏；
- 第一次失败后的重试；
- fallback；
- 第一部分收束；
- 最终结局或 handoff。

#### C. 真实 DeepSeek 连续流程

中文和英文各自完成：

```text
创建新 run
→ 生成开场
→ 提交多种决策
→ 连续生成和持久化
→ 恢复 run
→ 到达阶段 handoff 或当前设计的终点
```

如果当前正式故事设计要求七阶段或完整第一部分，验收就必须运行到该终点，不能只跑第一回合。

每个生成结果必须验证：

- 当前语言正确；
- 人物和官职符合术语表；
- 无错误语言泄漏；
- 没有未知人物或证据；
- 决策可以执行；
- 下一回合能继续；
- 持久化后读回内容一致；
- billing、幂等和失败释放没有因语言重试产生重复业务扣费。

### 17.9 Solo 完整浏览器流程

中文和英文各跑一遍完整可见路径：

```text
首页
→ 登录
→ Worlds
→ 桑田诏详情
→ 选择 Solo
→ 角色选择
→ 创建新故事
→ DeepSeek 开场
→ 提交推荐决策
→ 查看结果
→ 提交自定义决策
→ 触发并修正 ActionGuard
→ 继续多个回合
→ 刷新页面并恢复
→ 到达阶段 handoff 或结局
→ 查看结果和分享
```

两种语言必须使用同一组业务断言，不能维护一套较弱的英文验收。

### 17.10 Multiplayer 完整浏览器流程

只要 Multiplayer 在当前产品中仍然可见或可创建，就必须在中英文都验证：

```text
创建房间
→ 第二名玩家通过邀请码加入
→ 各玩家选择角色
→ Ready
→ 房主开始
→ 所有玩家提交决策
→ AI 共同推演
→ 下一回合
→ 断线恢复
→ 房间结果
```

至少检查：

- 房间所有玩家使用同一 `contentLocale`；
- 不同玩家的 `uiLocale` 不改变房间故事语言；
- AI 控制角色使用房间语言；
- 私密与公开消息使用正确语言；
- 等待、推演、超时和错误状态无语言泄漏。

如果英文版本暂时隐藏 Multiplayer：

- 必须有产品批准的功能开关；
- 英文页面不能留下可以进入未适配 Multiplayer 的入口；
- 中文 Multiplayer 必须继续正常；
- 项目只能标记为“英文 Solo 发布就绪”，不能标记为“完整双语言完成”。

### 17.11 Credits、Auth 与分享业务流程

语言改造不能只验证故事页面。

中英文分别验证：

- Email 登录、注册、退出；
- 未登录重定向与 returnTo；
- Google 不可用提示；
- 忘记密码和重置密码；
- Credits 余额；
- 创建 run 时余额不足；
- 套餐选择和确认；
- success、pending、cancel、failed；
- Account 购买记录；
- 创建邀请或结果分享；
- 复制链接；
- 撤销分享；
- 过期和无效分享。

涉及真实支付或外部 OAuth 时，自动化环境使用受控测试提供方；不能用“外部服务没配”把页面语言与本地交互测试整体跳过。

### 17.12 持久化与语言隔离测试

必须证明：

- 中文 run 写入中文内容；
- 英文 run 写入英文内容；
- 刷新和重新登录后仍读取原语言；
- 切换 `uiLocale` 不会改变已创建 run 的 `contentLocale`；
- 中文 run 不会被英文环境错误恢复；
- 英文 run 不会回退到中文 story package；
- Multiplayer 房间所有成员读取相同 `contentLocale`；
- 失败的语言校验结果不会先写入数据库；
- 英文重试不会写入两份世界事件或重复扣费。

需要保存数据库或 API readback 证据，不能只看浏览器最终画面。

### 17.13 自动化分层

计划新增或扩展以下测试：

```text
scripts/i18n/check-locale-parity.mjs
scripts/i18n/check-route-locale-coverage.mjs
scripts/i18n/check-rendered-locale.mjs
scripts/i18n/check-english-api-fixtures.mjs
apps/web/tests/i18n-runtime.test.mjs
apps/web/tests/i18n-route-coverage.test.mjs
apps/web/tests/i18n-rendered-pages.test.mjs
apps/api/src/i18n/*.spec.ts
apps/api/src/solo-story-engine/__tests__/bilingual-prompt.spec.ts
apps/api/src/solo-story-engine/__tests__/bilingual-output-validator.spec.ts
scripts/acceptance/bilingual-visible-journeys.mjs
```

测试分层：

1. Locale unit test；
2. key completeness；
3. parity；
4. route coverage；
5. rendered DOM；
6. API contract；
7. deterministic story fixtures；
8. real DeepSeek；
9. real browser；
10. DB readback；
11. release artifact scan。

### 17.14 测试证据产物

每次完整验收输出独立结果目录：

```text
artifacts/i18n-acceptance/<timestamp>/
├─ summary.json
├─ route-matrix.json
├─ api-matrix.json
├─ deepseek-runs.json
├─ db-readback.json
├─ console-errors.json
├─ network-errors.json
├─ zh-CN/
│  ├─ desktop/
│  └─ mobile/
└─ en/
   ├─ desktop/
   └─ mobile/
```

`summary.json` 必须记录：

- commit SHA；
- locale；
- 运行命令；
- 开始和结束时间；
- 页面总数；
- 页面通过数；
- 状态总数；
- 状态通过数；
- API 用例；
- DeepSeek run ID；
- 数据库 readback；
- 中文泄漏数量；
- 未解析 key 数量；
- 最终 PASS/FAIL。

### 17.15 失败判定

出现以下任意一项，整体验收失败：

- 页面打不开或 404；
- 页面只显示 Loading；
- 按钮不能操作；
- 导航错误；
- 当前语言缺少 key；
- 中文模式错误回退英文；
- 英文模式出现汉字；
- DeepSeek 使用错误语言；
- fallback 使用错误语言；
- API code 或 Schema 因翻译发生变化；
- 中英文规则或 stable ID 不一致；
- 已创建 run 恢复后语言改变；
- 英文重试产生重复事件或重复扣费；
- 只通过 fixture，没有真实 DeepSeek；
- 只通过 API，没有真实浏览器；
- 只跑第一回合，没有达到当前设计终点；
- 有未覆盖的当前产品路由或启用功能。

HTTP 200、构建成功、单元测试通过、页面截图正常或扫描零命中，任何一项单独存在都不能代表整体 PASS。

### 17.16 双语言发布门禁

计划提供统一命令：

```bash
pnpm test:i18n:full
```

该命令按顺序执行：

```text
中文 unit/contract
→ 英文 unit/contract
→ locale parity
→ route coverage
→ 中文 rendered pages
→ 英文 rendered pages
→ 中文 API
→ 英文 API
→ 中文 story fixtures
→ 英文 story fixtures
→ 中文 browser journey
→ 英文 browser journey
→ DB readback
→ English artifact scan
```

真实 DeepSeek 和需要外部测试环境的流程可以由单独 acceptance 命令执行，但最终 `OK` 报告必须同时包含其成功证据。

---

## 18. 两天实施计划

两天目标是完成“中文继续跑 + 英文对应内容准备并能切换”的首个可运行版本。

### 第一天上午：基础设施

- 建立 glossary。
- 建立 locale 类型和规范化函数。
- 建立 Web `t()`。
- 建立桑田诏 `locale-manifest.json`。
- 建立 `zh-CN` 和 `en` 目录。
- 建立一致性校验脚本骨架。
- 默认保持 `zh-CN`，先跑中文回归。

### 第一天下午：Web 与世界投影

- 抽取 `app.js` 玩家固定文案。
- 抽取 legacy storage 玩家固定文案。
- 完成 `en/messages.json`。
- 完成桑田诏 game/role/presentation 英文内容。
- 让 `/api/v4/worlds/sangtian` 按 locale 投影。
- 让角色选择页按 locale 显示。
- 新增 `dev:zh` 和 `dev:en`。
- 验证中文和英文页面可以分别启动。

### 第二天上午：DeepSeek 与剧情运行时

- 抽取 Solo Prompt 语言策略。
- 建立英文 Prompt policy。
- 建立英文 glossary 注入。
- 分离中文和英文长度预算。
- 翻译玩家可见 fallback。
- 增加英文输出汉字检查和一次修复重试。
- 处理当前 Solo 活跃路径的英文故事上下文。

### 第二天下午：验证与发布闭环

- 完成 Web 英文构建。
- 运行 locale parity。
- 生成当前完整路由 manifest。
- 运行中英文 route coverage 和 rendered DOM 测试。
- 运行英文 Web 扫描和 API 响应扫描。
- 跑中文完整 Solo 浏览器路径。
- 跑英文完整 Solo 浏览器路径。
- 中英文分别执行真实 DeepSeek 连续生成、恢复和 DB readback。
- 如果 Multiplayer 仍然启用，运行中英文 Multiplayer 路径。
- 输出 `artifacts/i18n-acceptance/<timestamp>/summary.json`。
- 任何未通过项都记录为 FAIL，不因两天期限到达而标记完成。

### 两天版本范围边界

两天内优先保证：

- 当前桑田诏新建 Solo；
- 当前官方角色路径；
- 当前活跃 story package；
- 当前启用 `sangtian_v1_2`；
- 页面、角色选择、主游戏和 DeepSeek 的英文闭环；
- 中文开发模式不被破坏。

两天内不把以下内容伪装为已完成：

- 所有旧中文 run；
- `sangtian_v1_1` 英文；
- 所有 Multiplayer 边界；
- 所有七阶段剧情的人工英文审校；
- 正式数据库 locale 迁移；
- 公开语言选择器。

以上范围可以作为后续任务，但有两条硬规则：

1. 当前仍然可见和可操作的功能必须通过双语言完整测试。
2. 未完成适配的功能必须通过明确功能开关从英文产品中完全移除，并将状态标记为局部就绪，不能将整个多语言任务标记为 `OK`。

---

## 19. 两天之后的完整多语言阶段

### 阶段 A：数据库语言锁定

- 增加 `Room.locale`；
- 增加 `StoryRun.locale`；
- 旧数据迁移为 `zh-CN`；
- 创建和恢复流程验证 locale；
- 禁止跨 locale 恢复。

### 阶段 B：Multiplayer

- 房主选择内容语言；
- 房间内 AI 角色使用相同语言；
- 所有玩家决策和公共结果使用房间语言；
- 私有 UI 可使用个人界面语言；
- 旧 v1.1 房间明确兼容策略。

### 阶段 C：完整桑田诏英文内容审校

- 七阶段；
- 六角色；
- 所有行动形式；
- 所有后果；
- 所有结局；
- 历史官职和机构译名；
- DeepSeek 连续回合风格；
- 人工剧情审校。

### 阶段 D：正式语言选择器

- 用户选择界面语言；
- 创建故事时选择内容语言；
- 语言选项只显示已通过完整性校验的语言；
- 不完整语言不得在生产显示。

### 阶段 E：新增语言

增加日语时只新增：

```text
locales/ja/
```

并通过同一套：

- glossary；
- completeness；
- parity；
- prompt policy；
- validator language；
- leak scan；
- browser acceptance。

---

## 20. 计划修改和新增的文件

### 20.1 预计新增

```text
apps/web/locales/zh-CN/messages.json
apps/web/locales/en/messages.json
apps/web/public/i18n-runtime.js

apps/api/src/i18n/locale.ts
apps/api/src/i18n/translator.ts
apps/api/src/i18n/leak-guard.ts
apps/api/src/i18n/messages/zh-CN.ts
apps/api/src/i18n/messages/en.ts

apps/api/src/solo-story-engine/locales/zh-CN/prompt-policy.ts
apps/api/src/solo-story-engine/locales/zh-CN/validator-language.ts
apps/api/src/solo-story-engine/locales/zh-CN/fallback-copy.ts
apps/api/src/solo-story-engine/locales/en/prompt-policy.ts
apps/api/src/solo-story-engine/locales/en/validator-language.ts
apps/api/src/solo-story-engine/locales/en/fallback-copy.ts

packages/templates/config/sangtian/locale-manifest.json
packages/templates/config/sangtian/locales/glossary.json
packages/templates/config/sangtian/locales/zh-CN/game.copy.json
packages/templates/config/sangtian/locales/en/game.copy.json

scripts/i18n/check-locale-parity.mjs
scripts/i18n/check-route-locale-coverage.mjs
scripts/i18n/check-rendered-locale.mjs
scripts/i18n/check-english-api-fixtures.mjs
scripts/i18n/run-localized-dev.mjs
scripts/deploy/prepare-web-locale.mjs

apps/web/tests/i18n-runtime.test.mjs
apps/web/tests/i18n-route-coverage.test.mjs
apps/web/tests/i18n-rendered-pages.test.mjs
apps/api/src/solo-story-engine/__tests__/bilingual-prompt.spec.ts
apps/api/src/solo-story-engine/__tests__/bilingual-output-validator.spec.ts
scripts/acceptance/bilingual-visible-journeys.mjs
```

### 20.2 预计修改

```text
package.json
apps/web/src/server.mjs
apps/web/public/app.js
apps/web/public/continuous-story-v2-legacy-storage.js
apps/web/public/continuous-story-v2-view.js
apps/web/public/role-select.js

apps/api/src/worlds.controller.ts
apps/api/src/game-page-projection.ts
apps/api/src/rooms.service.ts
apps/api/src/solo-story-engine/prompt-builder.ts
apps/api/src/solo-story-engine/output-validator.ts
apps/api/src/solo-story-engine/context-compiler.ts
apps/api/src/solo-story-engine/reference-binder.ts
apps/api/src/solo-story-engine/solo-story-engine.service.ts

packages/templates/src/game-registry/loader.ts
scripts/deploy/prepare-vercel-web-assets.mjs
```

具体修改范围以实施时的当前工作区为准。当前这些文件中有多项未提交修改，实施前必须确认其他任务不再同时编辑相同区域。

---

## 21. 风险与处理

### 风险 1：复制完整 JSON 导致规则漂移

处理：

- 只允许语言字段不同；
- stable ID、数值和关系由 parity 脚本强制一致；
- 业务规则仍以共享核心为权威。

### 风险 2：英文模式混入中文

处理：

- Web 构建扫描；
- API 投影扫描；
- DeepSeek 持久化前扫描；
- 英文生产禁止回退到中文。

### 风险 3：中文回归

处理：

- 默认仍为 `zh-CN`；
- 中文字符串先原样抽取；
- 抽取阶段不润色；
- 中文浏览器路径作为强制验收。

### 风险 4：旧存档混合语言

处理：

- 两天阶段使用环境或账号隔离；
- 不恢复另一语言的 run；
- 正式多语言前持久化 StoryRun locale。

### 风险 5：DeepSeek 英文能输出，但历史味道变差

处理：

- 人工批准术语表；
- 英文 Prompt 单独设计，不机械直译；
- 英文长度和风格单独校验；
- 真实连续回合审校；
- 首发内容标记为 Beta，未审校内容不扩大开放。

### 风险 6：并发任务覆盖修改

当前 `app.js`、`game.json`、Solo Story Engine 等目标文件已有其他未提交修改。

处理：

- 默认开发规则仍以 `main` 为准；
- 如果项目所有者明确批准多语言专用分支和独立 worktree，则只在批准的名称和目录中实施；
- 无论采用哪种方式，实施前都要形成可运行的已提交基线；
- 实施前冻结目标文件的并发修改，或者明确文件所有权；
- 不 reset、不覆盖、不回滚其他任务；
- 每一阶段只修改明确文件；
- 分支实施时定期同步最新 `main`，最终 rebase 并完成双语言全量验收后再合回；
- 冲突无法确认归属时立即暂停并报告。

---

## 22. 回滚方案

第一阶段必须支持安全回滚：

1. 默认 locale 设回 `zh-CN`。
2. 中文兼容入口继续读取原 `game.json`。
3. `dev:zh` 不依赖英文文件。
4. 英文 Loader 故障不得破坏中文 Loader。
5. 语言生成文件只存在于构建目录，可以重新生成。
6. 不通过删除中文或覆盖中文完成英文发布。

如果英文运行时未通过验收，可以停止英文发布，同时中文开发继续，不需要恢复被覆盖的中文内容。

---

## 23. 验收标准

### 23.1 验收状态定义

只允许以下状态：

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
FAIL
PASS
```

只有本节全部项目通过，才允许最终状态为 `PASS`，也就是用户定义的 `OK`。

不存在“代码已完成但测试以后再补”的 `PASS`，也不存在“英文通过所以忽略中文回归”的 `PASS`。

### 23.2 全路由覆盖

- [ ] 自动生成当前 Local 和 Vercel 路由 manifest。
- [ ] Local 与 Vercel 产品路由集合一致。
- [ ] manifest 中每个页面都有中文测试。
- [ ] manifest 中每个页面都有英文测试。
- [ ] 每个动态路由有可运行 fixture 或真实数据。
- [ ] 新增路由没有双语言测试时 CI 会失败。
- [ ] 所有路由在 Desktop 和 Mobile 都完成渲染检查。

### 23.3 中文通道完成

- [ ] `pnpm dev:zh` 可启动 API 与 Web。
- [ ] 当前所有产品页面可以正常打开。
- [ ] 所有页面 Loading、Empty、Success、Error 状态有中文覆盖。
- [ ] 所有按钮、表单、Dialog、Toast 和导航可以正常操作。
- [ ] 首页、Worlds、桑田诏详情、Rooms、Role Select、Game、Result、Credits、Account、Auth、Legal 和分享路径均通过。
- [ ] 六个桑田诏角色资料为中文。
- [ ] 中文 DeepSeek Prompt 选择正确。
- [ ] 中文开场、推荐决策、自定义决策、对话、调查、筹码、重试、fallback 和结局均通过。
- [ ] 中文真实故事运行到当前设计终点。
- [ ] 中文 run 刷新和重新登录后可以恢复。
- [ ] 中文数据库 readback 与页面内容一致。
- [ ] 中文 Credits、分享和 Multiplayer（如启用）没有回归。
- [ ] 没有未解析翻译 key。
- [ ] 没有非批准的英文 fallback。
- [ ] 中文 API code、Schema、规则、数值和 stable ID 未改变。
- [ ] 现有中文开发流程没有被英文文件阻断。

### 23.4 英文通道完成

- [ ] `pnpm dev:en` 可启动 API 与 Web。
- [ ] 与中文相同的全部产品页面可以正常打开。
- [ ] 与中文相同的全部页面状态和操作可以正常执行。
- [ ] 所有可见页面文字为英文。
- [ ] title、description、placeholder、aria-label、Toast、Dialog、Loading、Empty 和 Error 为英文。
- [ ] `/api/v4/worlds/sangtian` 玩家字段为英文。
- [ ] 六个角色、官职、地点、指标使用批准术语。
- [ ] 英文 DeepSeek Prompt 和 glossary 选择正确。
- [ ] 英文长度预算和英文 validator 生效。
- [ ] 英文开场、推荐决策、自定义决策、对话、调查、筹码、重试、fallback 和结局均通过。
- [ ] 英文真实故事运行到与中文相同的设计终点。
- [ ] 英文 run 刷新和重新登录后可以恢复。
- [ ] 英文数据库 readback 与页面内容一致。
- [ ] 英文 Credits、分享和 Multiplayer（如启用）正常。
- [ ] Web 构建产物没有产品中文。
- [ ] 渲染后的 DOM 和动态弹窗没有汉字。
- [ ] API 玩家响应没有汉字。
- [ ] DeepSeek 输出和持久化故事没有汉字。
- [ ] 没有未解析翻译 key。
- [ ] 缺失英文翻译时明确失败，不回退中文。

### 23.5 业务等价完成

- [ ] 中英文 route matrix 的路由集合相同。
- [ ] 中英文 state matrix 的状态集合相同。
- [ ] 中英文 API Schema 相同。
- [ ] 中英文 error code 和 HTTP 状态相同。
- [ ] 中英文 stable ID、规则、数值、权限和因果关系相同。
- [ ] 只有批准的玩家可读文案和 locale 元数据不同。
- [ ] 同一决策 fixture 在两种语言得到等价业务结算。
- [ ] 语言切换不会修改源文件。
- [ ] 语言切换不需要 Git reset。
- [ ] parity 检查通过。

### 23.6 故事与存档隔离完成

- [ ] 新建中文 run 锁定 `zh-CN`。
- [ ] 新建英文 run 锁定 `en`。
- [ ] 切换 UI 语言不改变已有 run 的 content locale。
- [ ] 中文 run 不被英文环境误恢复。
- [ ] 英文 run 不加载中文 story package 或 fallback。
- [ ] 失败模型输出不会在校验前持久化。
- [ ] 英文语言重试不会产生重复事件、重复提交或重复业务扣费。
- [ ] Multiplayer 房间所有玩家共享同一 content locale。

### 23.7 自动化与真实验收完成

- [ ] Locale unit tests 通过。
- [ ] Translation key completeness 通过。
- [ ] Locale parity 通过。
- [ ] Route coverage 通过。
- [ ] 中文 rendered page tests 通过。
- [ ] 英文 rendered page tests 通过。
- [ ] 中文 API contract 通过。
- [ ] 英文 API contract 通过。
- [ ] 中文 story fixtures 通过。
- [ ] 英文 story fixtures 通过。
- [ ] 中文真实 DeepSeek 连续流程通过。
- [ ] 英文真实 DeepSeek 连续流程通过。
- [ ] 中文真实浏览器全路径通过。
- [ ] 英文真实浏览器全路径通过。
- [ ] DB readback 通过。
- [ ] 英文发布扫描通过。

### 23.8 验收证据完成

- [ ] 有本次验收 commit SHA。
- [ ] 有完整 `route-matrix.json`。
- [ ] 有完整 `api-matrix.json`。
- [ ] 有中英文 Desktop 截图。
- [ ] 有中英文 Mobile 截图。
- [ ] 有 DeepSeek run ID 和生成结果。
- [ ] 有数据库 readback。
- [ ] 有 console/network error 汇总。
- [ ] 有最终 `summary.json`。
- [ ] `summary.json` 中所有强制项为 PASS。

### 23.9 最终 Gate

最终判断逻辑：

```text
中文全页面功能 PASS
AND
英文全页面功能 PASS
AND
中文完整故事 PASS
AND
英文完整故事 PASS
AND
双语言业务等价 PASS
AND
无错误语言泄漏
AND
发布产物扫描 PASS
= OK
```

只要其中一项不成立，结果就是：

```text
NOT OK
```

---

## 24. 最终决策

本项目采用以下语言策略：

1. 当前中文版本继续作为剧情开发和内容审校的重要工作通道。
2. 英文版本作为独立语言内容准备，不覆盖中文。
3. 业务规则、稳定 ID、因果结构和素材路径跨语言共享。
4. Web、桑田诏内容、API 消息、DeepSeek Prompt、校验器和 fallback 均按 locale 分层。
5. 开发环境允许显式选择 `zh-CN` 或 `en`。
6. 海外首发只启用 `en`。
7. 一个故事创建后锁定内容语言；界面语言未来可以独立切换。
8. 正式开放中文切换前，再增加数据库 locale 和旧数据迁移。

该方案的成功标准不是“仓库中没有中文”，而是：

> 中文开发能力完整保留；英文运行路径准备完成；两种语言不会在同一玩家故事中意外混用；正式英文发布不会向玩家泄漏中文。
