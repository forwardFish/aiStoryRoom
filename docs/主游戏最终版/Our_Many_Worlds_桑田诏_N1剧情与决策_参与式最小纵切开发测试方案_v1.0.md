# Our Many Worlds《桑田诏》N1“剧情 + 决策”参与式最小纵切开发测试方案 v1.0

> 文档状态：待执行基线
>
> 制定日期：2026-08-13
>
> 开发分支：`main`
>
> 玩家验收入口：真实 `/game?runId=...`
>
> 当前代码状态：本方案成文时尚未为该方案修改产品代码

## 1. 这次到底要解决什么

这次不做一套新的剧情系统，也不试图一次性优化 N1–N7。

唯一目标是：

> 在真实游戏里，让 N1 的“剧情现场 → 玩家决策 → 六席结算 → 结果剧情 → 下一压力”形成一段好玩的连续体验，并让项目所有者在每一步修改后立即进入真实游戏判断效果。

最终质量由项目所有者根据真实游玩体验验收。自动化测试只负责证明事实没有写错、权限没有越界、规则没有漂移、旧流程没有被破坏，不能代替人的剧情质量判断。

## 2. 为什么现状需要改

当前问题不是单纯“文案不够华丽”，而是剧情与决策之间可能存在四种断裂：

1. 玩家看到的局势没有自然推出眼前的决策。
2. 选项只说明“做什么”，没有说清收益、放弃了什么以及什么条件下会留下风险。
3. 玩家提交后生成的剧情可能没有准确回显玩家的选择。
4. 静态按钮文案可能被错误地当作六席共同结算后的事实，导致虚假因果或虚假主角感。

最危险的错误是：

> 把“玩家按下按钮时想做什么”预写成“六席结算后世界实际发生了什么”。

Solo Run 仍然包含一名真人席位与五个自动席位。最终结果是六席行动共同结算的产物，因此静态 Catalog 只能保存玩家行动意图和场景方向，不能预写最终结果、其他席位是否补位、下一决策或人物的正式反应。

## 3. 为什么这个改法可能改善体验

本方案把一轮体验拆成四个必须互相衔接的事实层：

```text
剧情现场
  ↓ 给出现在必须处理的冲突
决策卡
  ↓ 让玩家理解收益、机会成本和条件风险
六席权威结算
  ↓ 决定世界实际上发生了什么
结果剧情
  ↓ 回显玩家行动、真实共同结果和下一压力
下一轮
```

它改善体验的理由是可直接检验的：

- 决策前补足“发生了什么、为什么现在必须选”，玩家不需要猜系统意图。
- 三个选项明确展示不同取舍，选择不再只是换一种说法。
- 结果剧情必须提到玩家真实选择，玩家能感到自己的行动进入了故事。
- 最终结果来自六席真实结算，不会把按钮文案冒充世界事实。
- 下一压力来自真实 `nextDecisionPin` 或权威延续数据，剧情不会在选择后突然断掉。
- 每层可以单独定位问题，避免一旦效果不好就重写整套系统。

这不是“改完一定好”的承诺。它的价值是让效果在数小时内可见、问题可以被准确归因，并把每轮返工限制在很小范围内。

## 4. 最小范围

### 4.1 本轮只做

- 内容：`N1.weir_crisis`。
- 模式：隔离的真实 Solo Run。
- 玩家席位：优先使用 Zhejiang Governor；准确席位 ID 以真实 Run 返回值为准。
- 玩家选项：
  - `EVACUATE_WEIRS`：组织堰区疏散；
  - `SEAL_BREACH_RECORD`：封存毁堤记录；
  - `SUPPORT_WEIR`：增援关键堰口。
- 玩家入口：现有正式 `/game`。
- 页面：保留已经批准的三栏信息架构、布局、样式、路由和交互。
- 参与方式：每个 Gate 完成后，项目所有者立即进入真实游戏测试。

### 4.2 本轮明确不做

- 不开发 N2–N7。
- 不新增数据库表或 migration。
- 不新增 API endpoint。
- 不新增页面、测试页面或平行游戏入口。
- 不修改 `/game` 布局、CSS、路由、组件结构或玩家可见交互方式。
- 不新增状态机、Worker、剧情引擎或替代 Narrative Runtime。
- 不新增公共 `TurnPresentation` 合同。
- 不修改六席 Settlement 权威、行动规则或胜负规则。
- 不把后端字段名、Hash、证据 ID、Provider 信息或调试标签显示给玩家。
- 不覆盖、吸收或清理其他任务的未提交改动。
- 未经另行授权，不提交、不推送、不部署、不迁移生产数据。

## 5. 核心设计原则

### 5.1 一个决策点只有一份内容来源

N1 的现场、问题、选项取舍和行动回显统一来自现有版本化内容 Catalog，避免同一含义分别散落在提示词、前端、后端常量和测试夹具中。

这里的“共同剧情决策合同”是现有 Catalog 内部结构的可选扩展，不是新的公共 API 合同，也不是新的运行时对象。

### 5.2 静态内容与运行时结果严格分离

Catalog 可以保存：

- 决策前的现场；
- 为什么此刻必须决定；
- 决策问题；
- 每个行动的收益；
- 机会成本；
- 条件风险；
- 玩家行动回显；
- 该行动可能贡献的规则字段引用；
- 场景的文学表现方向。

Catalog 不得保存：

- 六席结算后的最终结果；
- 其他席位是否补位；
- 哪些问题最终仍未解决；
- 某个角色作出的正式承诺、立场改变或权威决定；
- 下一决策的实际内容；
- “完全因为玩家”而发生的共同结果。

### 5.3 玩家行动与共同结果分开表达

允许：

```text
你选择了组织疏散。
本轮六席结算后，疏散、守堰和责任记录均得到推进。
```

禁止：

```text
完全因为你的决定，九堰危机得到全面控制。
```

除非系统存在反事实证明，否则 Narrative 不得把六席共同结果全部归因给玩家。

### 5.4 事实锚点必须短，文学表达仍由 Narrator 完成

第一版只要求三个短锚点：

| 锚点 | 含义 | 权威来源 |
|---|---|---|
| `PLAYER_ACTION` | 玩家实际提交了什么 | 玩家自己的 sealed action |
| `POST_BEAT_RESULT` | 六席结算后实际发生了什么 | `WorkingDelta` / `stateAfter` 等真实结算结果 |
| `NEXT_PRESSURE` | 为什么故事必须继续 | 真实 `nextDecisionPin` 或权威延续数据 |

`VISIBLE_REACTION` 不默认强制。只有现有数据中确实存在合法、Viewer-safe 的反应摘要时才加入。没有权威来源时，Narrator 可以描写雨势、水声、动作、停顿和气氛，但不能捏造人物的正式承诺、态度变化或决定。

每条 required claim 必须满足：

- 12–28 个汉字；
- 一条只表达一个事实；
- 不出现字段名；
- 不出现“系统、数值、规则结算”等工程语言；
- 能自然嵌入对白、动作和场景描写。

## 6. Gate 0：修改前真实基线与 Narrative Source Trace

### 6.1 目的

在修改任何产品代码前，确认玩家提交 N1 后，真实 `/game` 最终展示的到底是哪一份 Narrative。

可能结果包括：

- N1 `BEAT_NARRATIVE`；
- N1 `CHAPTER_NARRATIVE`；
- N2 开场 Narrative；
- Narrative 被切换、覆盖或为空。

如果不先确认这一点，后续可能修改了正确的编译器，却没有修改真实页面实际读取的 Narrative。

### 6.2 执行方式

1. 确认当前分支仍为 `main`。
2. 检查工作树，确认拟修改文件没有与其他任务重叠。
3. 启动或复用当前 `main` 的真实 API、Web 和 Narrative Worker。
4. 创建与其他测试数据隔离的 Solo Run。
5. 向项目所有者提供真实 `/game?runId=...`。
6. 项目所有者亲自完成一次 N1。
7. 保存提交前、提交后的 `/game` 响应和浏览器证据。

### 6.3 必须记录的响应字段

```text
chapter.chapterId
chapter.chapterRuntimeId
decision.decisionPointId
narrative.status
narrative.projectionKind
narrative.sourceAuthority
narrative.sourceId
```

同时记录：

- Run ID 和玩家席位；
- 提交的 action ID；
- 页面提交前后的可见剧情摘要；
- Narrative 请求的时间顺序；
- 浏览器控制台错误；
- 失败的网络请求；
- 稳定页面截图。

运行时证据临时保存到：

```text
.codex-runtime/n1-story-decision/<runId>/
```

不得保存 Token、Cookie、完整秘密 Prompt、其他席位私密数据或 Provider 密钥。只有在项目所有者认可方案并另行允许后，才把脱敏证据转成正式仓库文档。

### 6.4 Gate 0 阻断条件

出现任一情况必须停止，不进入 Gate 1：

- 无法判断真实 `/game` 显示的 Narrative 来源；
- 当前服务不是本地 `main` 的代码；
- 需要触碰生产数据才能创建 Run；
- 页面或接口存在与本方案无关的阻断故障；
- 拟修改文件与其他未提交任务发生归属冲突；
- Source Trace 指向完全不同的运行时路径，需要扩大方案范围。

### 6.5 项目所有者参与点

项目所有者进入真实 `/game`，完成一次 N1，并先记录修改前感受：

- 是否立刻理解当前冲突；
- 三个选项是否有明显区别；
- 是否知道自己放弃了什么；
- 提交后是否看到自己的选择进入剧情；
- 剧情是否自然进入下一压力。

预计时间：15–30 分钟。

## 7. Gate 1：只优化 N1 决策体验

Gate 1 不修改 Narrative 结果生成。先让项目所有者确认“决定本身是否好玩”。

### 7.1 Catalog 内部可选字段

给 `N1.weir_crisis` 增加：

```ts
experience?: {
  situation: string;
  whyNow: string;
  question: string;
}
```

给 N1 的三个行动增加：

```ts
experience?: {
  benefit: string;
  opportunityCost: string | null;
  conditionalRisk: string | null;
  actionEcho: string;
  contributionRefs: TypedEffectRef[];
  sceneFrame: string;
}
```

这些字段在 N1 之外均为可选，旧章节和旧 Run 不得因为缺少它们而失败。

### 7.2 为什么使用 opportunityCost 和 conditionalRisk

当前规则并不一定发生真实资源扣除，因此不使用容易造成误解的 `cost` / `risk`。

- `opportunityCost`：选择这个行动意味着本席本轮没有选择另外两件事。
- `conditionalRisk`：只有在其他席位没有补位或结算条件不满足时才可能留下的缺口。

示例：

```text
收益：优先保护低洼堰区百姓。

机会成本：本席本轮不同时选择守堰或封存记录。

条件风险：若其他席位未补位，堰口和责任证据仍可能留下缺口。
```

### 7.3 映射到现有页面

不改前端页面和公共 API 结构，只把新内容映射到现有投影字段：

```text
decision.title
← question

decision.summary
← situation + whyNow

option.description
← benefit + opportunityCost + conditionalRisk
```

### 7.4 文本预算

| 内容 | 最大长度 |
|---|---:|
| `question` | 30 个汉字 |
| `situation` | 70 个汉字 |
| `whyNow` | 50 个汉字 |
| 选项 `label` | 10 个汉字 |
| `benefit` | 32 个汉字 |
| `opportunityCost` | 42 个汉字 |
| `conditionalRisk` | 42 个汉字 |
| 最终 `option.description` | 110 个汉字 |

### 7.5 预计修改文件

以下是 Gate 1 的预期准确范围；若 Gate 0 证明真实读取链不同，必须先更新本文档再动代码：

| 文件 | 预计改动 |
|---|---|
| `packages/templates/config/sangtian/pressure-chapter-v1/release/action-presentation-catalog.json` | 只增加 N1 现场、问题、取舍、行动回显、贡献引用和场景方向 |
| `packages/templates/src/pressure-chapter/release/types.ts` | 给现有 Catalog 类型增加可选内部字段 |
| `packages/templates/src/pressure-chapter/release/loader.ts` | 校验可选字段、长度和引用合法性，并兼容旧内容 |
| `apps/api/src/pressure-chapter/integration/content.adapters.ts` | 将 N1 experience 映射到现有 `decision` 投影 |
| 现有对应 focused tests | 覆盖映射、长度、缺省兼容、N1 之外零变化 |
| `orchestration-package.json` / `release-manifest.json` | 只在内容变更要求时更新对应 Hash，不改变运行规则 |

### 7.6 Gate 1 自动检查

- 类型检查通过。
- Catalog loader 能读取新 N1 和旧格式内容。
- 三个 option ID 不变。
- 规则 effect 不变。
- N2–N7 的序列化结果不变。
- 页面仍消费原有 `decision.title`、`decision.summary` 和 `option.description`。
- 没有玩家可见前端文件进入改动列表。

### 7.7 项目所有者参与点

完成后立即创建新的真实 Solo Run。项目所有者只判断决策部分：

1. 当前冲突是否一眼能懂；
2. 决策是否自然从剧情中出现；
3. 三个选项是否真的让人纠结；
4. 是否清楚每个选项的收益与放弃；
5. 条件风险是否诚实，没有预言其他席位一定不补位；
6. 文本是否太长、太像行政说明。

若不认可，只修改 N1 Catalog 内容，不进入 Gate 2，不修改 Narrative Compiler。

预计时间：45–90 分钟。

## 8. Gate 2：让选择后的剧情真实衔接

只有项目所有者明确认可 Gate 1 后才执行。

### 8.1 运行时输入

根据 Gate 0 确认的真实 Narrative Source，复用现有权威数据：

```text
玩家自己的 sealed action
六席真实 WorkingDelta / stateAfter
真实 nextDecisionPin
必要时的 Chapter Settlement / carryForward
```

不得让 Catalog、前端或 Provider 自行猜测上述事实。

### 8.2 Catalog 在 Gate 2 中的作用

Catalog 只提供：

```json
{
  "actionEcho": "胡宗宪先下令疏散低洼堰区。",
  "contributionRefs": [
    { "kind": "FACT", "ref": "evacuationCoveragePct" },
    { "kind": "FACT", "ref": "disasterSeverity" }
  ],
  "sceneFrame": "表现传令、百姓撤离和持续上涨的水势。"
}
```

- `actionEcho` 只陈述玩家确实选择的行动。
- `contributionRefs` 只声明该行动可能关联哪些已有规则事实，不能代替最终结算。
- `sceneFrame` 只提供文学表现方向，不能包含最终事实。

### 8.3 Narrative Compiler 输出要求

编译出的 required claims 至少包含：

```text
PLAYER_ACTION
POST_BEAT_RESULT
NEXT_PRESSURE
```

Provider 可以围绕短锚点自由写对白、动作、雨势、水声、传令、停顿和场景节奏，但 Truth Guard 必须阻止以下内容：

- 与 sealed action 不一致；
- 与六席结算后的状态不一致；
- 把共同结果全部归因给玩家；
- 捏造人物权威反应；
- 泄露其他席位私密信息；
- 捏造下一决策或跳过真实 `nextDecisionPin`。

### 8.4 Gate 2 预计修改范围

Gate 0 Source Trace 是准确文件范围的决定条件。预期只会涉及现有 Narrative Authority 链中的最小位置，例如：

| 候选文件 | 只有何时修改 |
|---|---|
| `apps/api/src/pressure-chapter/narrative-authority/compiler.ts` | 真实页面显示的目标 Narrative 确实由该编译器生成，且现有 required claims 缺少三类锚点 |
| `apps/api/src/pressure-chapter/integration/content.adapters.ts` | 编译器需要读取 Catalog 中的 `actionEcho`、`contributionRefs` 或 `sceneFrame` |
| 现有 Narrative focused tests | 覆盖玩家行动、共同结果、下一压力和禁止虚假归因 |
| 现有 projection/persistence 文件 | 仅当 Source Trace 证明权威字段已经存在但在真实读取链中被遗漏；若与其他任务脏改重叠则立即停止 |

如果真实页面显示的是 Chapter Narrative 或 N2 opening，而不是预期 Beat Narrative，必须先记录结论并重新明确 Gate 2 文件清单，不能凭猜测同时修改多个 compiler。

### 8.5 Gate 2 自动检查

- 三个玩家选择产生不同的 `PLAYER_ACTION`。
- `POST_BEAT_RESULT` 与真实六席结算一致。
- `NEXT_PRESSURE` 与真实下一决策一致。
- 不把六席共同结果冒充玩家单独贡献。
- 缺少 Viewer-safe reaction 时不生成正式人物反应。
- Required claim 长度与语言约束通过。
- Truth Guard 仍能拒绝事实篡改、越权信息和错误归因。
- Settlement、资源、胜负和状态推进结果与修改前一致。

### 8.6 项目所有者参与点

完成后立即提供新的真实 Run。项目所有者判断：

1. 剧情是否明确写出了自己的选择；
2. 结果是否像剧情，而不是结算报告；
3. 六席共同结果是否可信；
4. 是否夸大玩家的单独贡献；
5. 下一压力是否自然延续；
6. 是否产生“我还想继续选”的动力。

预计时间：60–120 分钟。

## 9. Gate 3：三个真实 Run 的对照测试

创建三个相互隔离、起始条件一致的真实 Solo Run：

| Run | 玩家选择 | 主要验证点 |
|---|---|---|
| A | 组织堰区疏散 | 玩家行动、共同救灾结果和未解压力是否衔接 |
| B | 封存毁堤记录 | 责任证据路线是否与疏散路线明显不同 |
| C | 增援关键堰口 | 守堰路线是否产生不同场景与结果表达 |

每个 Run 都记录 Gate 0 中的 Source Trace 字段，并检查：

1. 三次 Narrative 是否真实不同，而不是只替换几个词；
2. 玩家选择是否被准确回显；
3. 最终结果是否符合各自六席真实结算；
4. 决策是否自然从前文产生；
5. 下一步是否自然延续；
6. 文本是否仍像故事；
7. 是否存在虚假因果、虚假反应或秘密泄露。

预计时间：30–60 分钟。

## 10. 每轮向项目所有者报告什么

每次交付测试链接前，必须先用简短清单说明：

```text
本轮 Gate：
真实 Run URL：
玩家席位：
本轮修改的准确文件：
玩家可见行为变化：
明确没有修改的系统：
自动检查结果：
已知限制：
请项目所有者重点判断：
```

项目所有者不需要判断内部实现是否优雅，但必须能够知道修改边界，防止过度设计和过度开发。

## 11. 反馈归因与最小返工规则

| 现场反馈 | 只处理哪一层 |
|---|---|
| 决策不好、选项不纠结 | 只改 N1 `experience` 内容 |
| 决策太长、像说明书 | 只压缩 Catalog 文本和映射组合 |
| 剧情事实不对 | 检查真实权威来源和 Narrative 编译，不润色掩盖 |
| 剧情事实正确但不好看 | 只调短锚点、`sceneFrame` 或现有 Narrative 表达约束 |
| 三个选择结果几乎相同 | 检查自动席位覆盖和真实结算，不用换词伪装差异 |
| `/game` 没显示目标 Narrative | 停止，回到 Source Trace，不继续改错误 compiler |
| 出现意外页面变化 | 立即停止，不提交受影响文件，先向项目所有者申请页面范围 |

N1 最多进行两轮现场调整。两轮仍未产生项目所有者能够明显感知的改善，就停止开发，报告失败发生在决策内容、结算输入、Narrative Source、编译约束还是模型表达层，不进入 N2，也不继续叠加新系统。

## 12. 验收标准

### 12.1 Gate 1 通过

只有项目所有者在真实 `/game` 明确认可以下结果，Gate 1 才通过：

- 冲突清楚；
- 决策由剧情自然推出；
- 三个选项存在真实取舍；
- 文本长度可接受；
- 没有把条件风险写成必然结果。

### 12.2 Gate 2 通过

只有项目所有者在真实 `/game` 明确认可以下结果，Gate 2 才通过：

- 剧情准确回显选择；
- 剧情符合六席真实结算；
- 没有虚假主角感；
- 下一压力自然出现；
- 正文像故事而不是规则报告。

### 12.3 N1 纵切通过

必须同时满足：

- A/B/C 三个真实 Run 均完成；
- 三个选择带来可感知的不同体验；
- 项目所有者明确认可 N1；
- focused tests 通过；
- 真实浏览器无阻断错误；
- 无页面边界、权限、秘密、Settlement 或旧 Run 兼容性回归；
- 已列明所有修改文件，且没有混入其他任务改动。

自动化通过但项目所有者不认可剧情质量，结论仍然是不通过。

## 13. 版本、提交与兼容性

本地实验阶段：

- 可以在 `main` 工作树中进行最小修改；
- 不提交、不推送、不部署；
- 每次只修改当前 Gate 的文件；
- 用文件级 diff 与 Hash 区分本方案改动和其他任务改动。

项目所有者认可并决定正式保留后：

1. 将 Catalog 版本从 `1.0.0` 升到 `1.0.1`；
2. 重新计算正式内容 Hash 和 manifest；
3. 验证新 Run 读取 `1.0.1`；
4. 验证旧 Run 仍能按其固定版本回读；
5. 若现有发布机制无法同时保证新旧内容，先提出最小版本化文件方案并等待批准；
6. 只暂存项目所有者确认的准确文件；
7. 提交、推送和部署均需另行授权。

禁止以“版本仍是 `1.0.0`，但内容已经改变”的方式正式提交。

## 14. 回滚方式

由于本轮不改数据库 Schema、不新增页面、不改公共 API，回滚以文件为单位：

- Gate 1 不通过：撤回 N1 Catalog experience、loader/type 可选字段和映射；
- Gate 2 不通过：撤回 Narrative 短锚点编译改动，保留已经单独认可的 Gate 1 内容需再次获得项目所有者确认；
- 任何页面意外变化：停止并排除玩家可见文件，不自行修补页面；
- 与其他任务冲突：不执行全局 reset、checkout、stash 或清理，只停止本方案并报告重叠文件。

在脏工作树中，禁止使用会影响其他任务的整体回滚命令。

## 15. 预计时间与停止点

| 阶段 | 预计时间 | 项目所有者何时参与 | 未通过时怎么做 |
|---|---:|---|---|
| Gate 0 | 15–30 分钟 | 立即完成修改前 N1 | Source 不清楚则停止 |
| Gate 1 | 45–90 分钟 | 立即测试新决策卡 | 只改 N1 JSON，最多两轮 |
| Gate 2 | 60–120 分钟 | 立即测试结果剧情 | 只处理已定位层级 |
| Gate 3 | 30–60 分钟 | 完成 A/B/C 三个 Run | 给出通过或失败结论 |

第一轮真实可玩目标约为 3–5 小时，不以“开发了多少代码”为完成标准，而以项目所有者能否在真实 `/game` 看到、比较并判断效果为标准。

## 16. 执行授权边界

本文件本身只记录方案，不代表自动获得提交、推送、部署或扩大玩家可见页面范围的授权。

进入实际开发时，本轮授权应准确表述为：

> 批准 N1 单人参与式最小纵切。先由项目所有者参与真实 `/game` 修改前测试并完成 Narrative Source Trace；随后只扩展 N1 决策现场、行动取舍、`actionEcho`、`contributionRefs` 和 `sceneFrame`。实际结果与下一压力必须从六席真实结算后的权威状态编译，不得在 Catalog 或前端预写。完成疏散、封存、守堰三个真实 Run 后立即停止，由项目所有者决定是否进入 N2。未经另行授权，不修改正式页面、不提交、不推送、不部署。

## 17. 下一步

本文档确认后，只执行 Gate 0：

1. 不改代码；
2. 启动当前 `main` 的真实本地游戏；
3. 创建一个隔离 Solo Run；
4. 提供 `/game?runId=...`；
5. 项目所有者完成一次 N1；
6. 完成 Narrative Source Trace；
7. 报告 Gate 1 的最终准确文件范围，等待开始 Gate 1。
