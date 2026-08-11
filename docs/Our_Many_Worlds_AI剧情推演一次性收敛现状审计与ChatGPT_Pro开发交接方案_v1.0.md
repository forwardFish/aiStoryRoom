# Our Many Worlds：AI 剧情推演一次性收敛现状审计与 ChatGPT Pro 开发交接方案 v1.0

> 审计日期：2026-08-05
> 协作流程修订：2026-08-05，增加 ChatGPT Pro 隔离分支开发、本地 Codex 独立复验与唯一合并责任。
> 审计范围：仅限《桑田诏》单人 AI 剧情推演，不包含主游戏页面、登录、积分、多人剧情和部署。
> 唯一真实模型：DeepSeek V4-Pro；不再使用 GLM。
> GitHub 仓库：`https://github.com/forwardFish/aiStoryRoom`
> 本地复验仓库：`D:\lyh\agent\agent-frame\aiStoryRoom`
> 冻结开发基线：`main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c`。
> ChatGPT Pro 权限边界：只能新建并推送开发分支，禁止直接修改、合并或推送 `main`。
> 最终集成责任：ChatGPT Pro 完成后，由本地 Codex 获取分支并独立测试；只有验证通过后，Codex 才能按仓库所有者授权合并 `main`。
> 最终目标：不是让模型“自由猜一个故事”，而是让系统依据剧本资产、权威世界状态、NPC 目标和玩家选择，连续生成像小说的真实剧情与真实决策。

---

## 一、先给结论

当前系统已经不是从零开始，也不能宣称完成。

准确判断是：

| 范围 | 当前状态 | 结论 |
|---|---|---|
| 可插拔回合运行骨架 | 已实现 | Action、Settlement、Next Beat、Projection、Narrator、Reviewer、Commit、Options 等模块已经存在 |
| 《桑田诏》第一部分结构化资产 | 已实现大部分 | 65 项运行资产、15 个 Decision Kernel、12 项剧情需求、4 条因果弧可重新编译 |
| DeepSeek V4-Pro 单回合小说表达 | 已验证 | T01—T03 两条分支都能生成有人物、现场、对话与冲突的正文 |
| 玩家选择影响下一回合 | 初步验证 | 选择“封存档房”会在下一回合保留封存结果；请求巡抚共同具名会触发巡抚拒绝和复核权争夺 |
| 关键事实连续性 | T01—T03 大体成立 | 没有出现会改变主线的重大冲突，但尚未连续验证到 T05/T20 |
| 自由输入 | 未完成，P0 | 未绑定到已展示选项的自由文字会丢失 Decision Kernel，运行直接失败 |
| Truth Reviewer | 合同错误，P0/P1 | 模型按 Prompt 返回 `NONE`，解析器却要求对象；Reviewer 每回合耗费 Token，却全部变成 `UNAVAILABLE` |
| 小说感 | 可玩但不稳定 | 已明显好于“结算结果＋下一项待办”，仍有重复句式、行政问答化和分支过快汇合 |
| 第一部分连续玩家验收 | 未完成 | 只有真实 T01—T03 证据，没有全新 G00—T05，更没有逐回合 G00—T20 玩家验收 |
| 第二至第四部分 | 未完成 | 当前正式资产只支撑第一部分；不能让模型自行猜完整故事 |
| 整部故事最终结局 | 未完成 | 当前 Ending 明确只是 `PART_END`，不是浙江总督在整部故事中的最终命运 |

因此，一次性开发的正确目标是：

> 先把世界无关的 AI 剧情推演引擎和《桑田诏》第一部分 G00—T20 做成可连续游玩的 MVP；此后第二至第四部分只新增故事资产，不再修改通用运行时逻辑。

以下三件事不能混为一谈：

1. 工程测试通过；
2. 模型真实生成成功；
3. 玩家读起来像真实故事，并且选择真正改变后续。

只有第三项通过，AI 剧情推演才算产品可用。

---

## 二、Git 基线、分支权限与三方责任

### 2.1 当前冻结基线

2026-08-05 重新核对后，三处 `main` 完全一致：

```text
本地 main HEAD     : 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
本地 origin/main   : 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
GitHub 远程 main   : 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
ahead / behind     : 0 / 0
```

旧审计中的 `7c87762 / 4afd7d8` 只属于历史记录，不再作为开发基线。ChatGPT Pro 必须从上述完整 SHA 创建新分支，不能从旧对话、旧缓存或旧分支继续。

### 2.2 强制开发分支

ChatGPT Pro 只能在新分支开发。建议固定分支名：

```text
codex/chatgpt-pro-ai-story-convergence
```

硬规则：

1. 分支必须直接继承 `main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c`；
2. ChatGPT Pro 不得直接修改、提交、合并或推送 `main`；
3. ChatGPT Pro 不得创建第二个临时开发分支来绕过目标分支；
4. ChatGPT Pro 只能把经过自身测试的提交推送到上述远程分支；
5. ChatGPT Pro 无权宣称已经合并、上线或完成最终验收；
6. 分支是否合并 `main`，只能由本地 Codex 在独立复验通过后执行，并且仍需仓库所有者授权。

如果 ChatGPT Pro 的运行环境不能读取 GitHub 仓库、不能检出目标分支或不能推送提交，必须停止并报告 `REPO_WRITE_ACCESS_MISSING`，不得只给出补丁文本后宣称开发完成。

### 2.3 ChatGPT Pro 开工门

ChatGPT Pro 在改动任何文件前必须读取根目录 `AGENTS.md` 和本文档，并输出：

```text
git remote -v
git branch --show-current
git rev-parse HEAD
git merge-base HEAD origin/main
git status --short
```

必须证明：

```text
repository = forwardFish/aiStoryRoom
branch = codex/chatgpt-pro-ai-story-convergence
base ancestor = 1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
main was not checked out for development
```

任一条件不满足，禁止开始编码。

### 2.4 本地工作区保护

本地 `main` 当前仍有其他任务的未提交文件，其中部分与 `scene-pipeline` 范围重叠。远程分支隔离可以保护开发过程，但不能自动解决最终合并冲突。

所有参与者必须遵守：

- 禁止 `git add .`；
- 禁止 `git reset --hard`、`git clean`、广泛 stash 和 force push；
- 禁止清理、重置、覆盖或顺带提交其他任务改动；
- 禁止把主游戏页面、登录、积分、多人剧情、部署或无关文档混入该分支；
- 禁止直接在当前脏 `main` 上执行 `git pull` 获取 Pro 的开发结果。

### 2.5 三方责任

| 角色 | 负责 | 不负责 |
|---|---|---|
| 仓库所有者 | 批准目标分支、决定是否允许最终合并 | 不需要手工搬运补丁 |
| ChatGPT Pro | 在目标分支实现 P0—P7、运行分支内测试、提交并推送、提供完整交接证据 | 不合并 `main`，不作最终 PASS 判断 |
| 本地 Codex | 获取远程分支、审查 diff、在隔离环境重新测试、验证真实模型与玩家证据、通过后执行获批合并 | 不盲信 Pro 报告，不覆盖本地其他任务文件 |

---

## 三、AI 剧情推演到底是什么

一回合的正确输入不是“上一段文字＋玩家选择，然后让 AI 接着写”。

正确输入是：

```text
玩家选择
+ 当前权威关键状态
+ 当前 Part / Section Contract
+ 当前 Decision Kernel
+ 对应原著场景机制或已批准改编
+ NPC 目标、筹码与反制政策
+ 已到期或正在逼近的后果
+ 最近已经发生的玩家可见 Canon
```

正确输出分成两个产品结果：

1. 一段真实发生的小说剧情；
2. 2—4 个承接正文结尾、普通玩家能理解的行动。

完整内部流程必须是：

```text
玩家行动
→ 意图与能力绑定
→ 事实结算
→ 保存关键状态
→ 检索剧本素材
→ 规划下一拍剧情
→ 玩家安全上下文投影
→ Narrator 写成小说
→ 最小关键错误检查
→ 原子提交 Canon 与状态
→ 根据真实正文结尾生成决策
→ 更新长期记忆
```

AI 不能自己决定：

- 下一步主线是什么；
- 玩家是否额外下达了某项命令；
- 新证据是否存在；
- 关键文书由谁保管；
- 哪个秘密已经被谁知道；
- NPC 是否突然拥有新的权限；
- 故事何时进入下一部分或最终结局。

AI 可以自由决定：

- 人物的动作、停顿、视线与普通对话；
- 灯火、衣袖、脚步、桌椅和天气等文学纹理；
- 不改变后续能力与因果的临时场景细节；
- 如何把已经规划好的剧情节拍写得像小说。

---

## 四、MVP 固定验收原则

当前阶段采用“抓大放小”。以下五项按顺序验收：

1. 主线和人物行为合理；
2. 玩家选择真实改变后续；
3. 关键事实前后一致；
4. 决策清楚，并且代表真正不同的行动；
5. 正文整体流畅，像故事而不是报告。

### 4.1 只有五类错误可以阻止发布

1. 明显偏离 Part / Section 主线；
2. 替换或反转了玩家已经选择的行动；
3. 关键人物、命令、证据、文书、秘密或权力状态发生硬冲突；
4. 擅自创造死亡、圣旨、战争、逮捕、关键证据、正式命令等重大事实；
5. 下一组决策与正文真实末态无关。

### 4.2 以下问题只记录，不阻断

- 普通物件的细微前后差异；
- 灯火、衣袖、脚步、案几、茶盏等文学细节；
- 个别句子重复；
- 局部文风还不够像《大明王朝1566》；
- 不影响因果的小时间、天气和布景差异；
- Reviewer 不可用或无法解析。

这些问题进入观察日志，后续逐模块优化，不能让玩家一直看不到剧情。

### 4.3 同类失败最多三次

同一个模块、同一种根因最多允许三轮验证。

第三次仍失败时必须：

1. 停止继续调用模型；
2. 明确报告失败属于哪个模块；
3. 说明现有合同为什么不成立；
4. 改变模块设计或暂时关闭可选模块；
5. 禁止继续增加中文同义词、故事专用正则或单场 Prompt 例外。

---

## 五、当前已经实现的模块

当前 `apps/openovel-runtime/src/runtime.ts` 已经注册了以下模块：

| 模块 | 当前代码状态 | 当前判断 |
|---|---|---|
| Action Gateway | 已有 | 能校验非空、长度和 Revision；不能理解未绑定自由输入 |
| Fact Settlement | 已有 | 《桑田诏》推荐选项可以生成结构化结算 |
| Next Beat Planner | 已有 | 依赖 Decision Kernel；自由输入缺 Kernel 时直接失败 |
| Context Compiler | 已有 | 已拆成模块，但素材边界和场景聚焦仍需加强 |
| Scene Render Planner | 已有 | 已能决定 Narrator / Protected Fallback 路径 |
| Player Projection | 已有 | 已隔离玩家可见上下文，但要继续收紧当前场景实体集合 |
| Narrative Renderer | 已有 | DeepSeek V4-Pro 已能生成可读小说场景 |
| Surface Guard | 已有 | 应只保留空文本、截断、系统字段泄漏等表层检查 |
| Truth Observer | 可插拔 | 目前 Schema 合同错误；应先 Observe-only 或 Disabled |
| Review Policy | 可插拔 | 本地已改为 Reviewer 不可用时保留正文 |
| Atomic Committer | 已有 | 已有状态与 Canon 提交基础 |
| Options And Memory | 已有 | 《桑田诏》主要使用 Story Package 的 authored options；Storykeeper 可关闭 |
| Ending | 已有阶段性版本 | 只支持第一部分 `PART_END`，不代表整部故事结局 |

模块注册支持 `REQUIRED / OPTIONAL / DISABLED / FALLBACK_ONLY`，说明“按模块定位和关闭问题”的底层方向已经成立，不应重新写一套单人专用运行时。

---

## 六、2026-08-05 实际验证结果

本节全部数字属于开发前的历史审计证据，用于复现根因，不是 ChatGPT Pro 候选分支的当前 PASS。Pro 和本地 Codex 都必须在各自阶段重新运行实际命令。

### 6.1 工程测试

执行：

```text
pnpm test:story:v4
```

结果：

```text
328 / 328 PASS
exit code 0
相关 TypeScript build / typecheck 通过
```

这只能证明工程合同没有明显回归，不能证明玩家体验通过。

### 6.2 剧本资产重新编译

在禁止回写源码的条件下，从当前审批资产重新编译第一部分：

```text
schemaVersion              = sangtian-part-one-authoring-release-v1
releaseVersion             = sangtian-part-one-authoring-v1.3.0
assetCount                 = 65
decisionKernelCount        = 15
causalArcCount             = 4
floorObligationCount       = 4
requirementCount           = 12
narrativeScenePatternCount = 3
evidenceProfileCount       = 1
```

重新编译文件与仓库文件 SHA‑256 完全一致：

```text
A63507E547E73A13953E20821DCDD6627CE520C3EEFD96DA0AF2249CFAB28A7E
```

结论：T1—T4 编译链是确定性的；问题不在“文件无法生成”，而在可直接支持小说场景的剧情素材覆盖不足。

### 6.3 自由输入真实失败

执行 HTTP smoke，提交未绑定到推荐选项的自然语言：

```text
暂不签发，先让两边把各自知道的事说清。
```

结果：

```text
turnNumber = 0
run status = FAILED
lastError  = PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING
```

因果链：

```text
Action Gateway 没有 BoundOption
→ bindIncomingAction 标记为 FREE_TEXT
→ 没有 decisionKernelId
→ Next Beat Planner 无法检索剧情依据
→ 为避免 AI 猜剧情，主动停止
```

这说明“页面允许自由输入”与“运行时能处理自由输入”目前不一致。

正确修复不是增加“暂不签发 / 未便遽行 / 签放”等中文同义词，而是新增世界无关的 Intent Resolver / Capability Binder。

### 6.4 DeepSeek V4-Pro 真实路径 A

冻结配置：

```text
provider        = https://api.deepseek.com
model           = deepseek-v4-pro
narrator        = deepseek-v4-pro
reviewer        = deepseek-v4-pro
options         = deepseek-v4-pro（若启用）
storykeeper     = deepseek-v4-pro（若启用）
thinking        = disabled
```

真实连续运行：T01—T03，无 Fallback。

| 回合 | 输入 Token | 输出 Token | Narrator 延迟 | 玩家结果 |
|---|---:|---:|---:|---|
| T01 | 3126 | 377 | 10.6s | 暂压放行文书，核对密信，书吏当面追问执行边界 |
| T02 | 3155 | 345 | 7.6s | 有限试办与禁买田写入回文，书吏继续追问督抚责任 |
| T03 | 2835 | 327 | 9.3s | 玩家要求共同具名后，巡抚明确拒绝，争议转向谁主持复核 |

玩家标准判断：

- 有明确现场、人物动作、对话和权力交锋；
- T03 确实继承了 T02 的玩家选择；
- 关键事实未发生明显硬冲突；
- T02 有轻微重复句段；
- 选项仍偏行政措施，小说感主要来自正文而不是决策文字。

### 6.5 DeepSeek V4-Pro 真实路径 B

开场选择：

```text
动用总督封缄令牌，先保住清流县档房现场，再给巡抚一个暂缓签发的答复。
```

结果：

- T01 正文实际写出封存命令与暂缓签发；
- T02 明确保留“档房已经被封”的关键状态；
- 分支关键事实连续；
- 但 T02 很快汇合到与路径 A 相同的责任具名选择。

结论：玩家选择已经能够改变短期状态和正文，但分支差异保持得不够久，需要关键状态和延迟后果参与后续检索，而不是下一回合马上归并成同一个待办。

### 6.6 Truth Reviewer 真实问题

每一个 DeepSeek V4-Pro 回合都出现：

```text
TRUTH_REVIEW_ADVISORY
SCENE_REVIEW_INVALID:P0_causalIntroduction_NOT_OBJECT
```

模型真实返回符合 Prompt 的内容：

```json
{
  "candidates": {
    "causalIntroduction": "NONE",
    "keyEntityState": "NONE",
    "secretLeak": "NONE",
    "playerAction": "NONE"
  }
}
```

但是解析器对四个字段调用 `exactObject(...)`，不接受字符串 `NONE`。

这不是 DeepSeek 不遵循，而是 Reviewer 的 Prompt 与 Schema 自相矛盾：

```text
Prompt：没有候选时返回 NONE
Parser：每个候选必须是对象
```

路径 A 中 Reviewer 额外消耗：

```text
输入 Token 约 12,793
输出 Token 469
延迟约 11 秒
可用 Review 结果 0
```

MVP 决策：在修复统一 Schema 前，Reviewer 默认 `OBSERVE_ONLY` 或 `DISABLED`；不可用时只记录，不能阻断玩家正文。

### 6.7 DeepSeek Thinking 兼容问题

启用 DeepSeek thinking 时，曾出现约 120 秒后：

```text
Provider returned an empty streamed response
```

当前流解析只读取：

```text
choices[0].delta.content
```

没有处理 `reasoning_content`。MVP 不需要为此阻塞，固定：

```text
OPENOVEL_DEEPSEEK_THINKING=disabled
```

以后如果要启用思考模式，再单独完善流协议适配和 Token 预算。

### 6.8 当前环境仍会误选 GLM

当前 `.env.test` 仍有：

```text
SOLO_STORY_MODEL=zai-org/GLM-5.2
```

如果没有显式设置 `OPENOVEL_MODEL`，测试仍可能走 GLM。

本方案要求所有真实剧情推演调用显式冻结到：

```text
OPENOVEL_PROVIDER_BASE_URL=https://api.deepseek.com
OPENOVEL_MODEL=deepseek-v4-pro
OPENOVEL_NARRATOR_MODEL=deepseek-v4-pro
OPENOVEL_REVIEWER_MODEL=deepseek-v4-pro
OPENOVEL_OPTIONS_MODEL=deepseek-v4-pro
OPENOVEL_STORYKEEPER_MODEL=deepseek-v4-pro
OPENOVEL_DEEPSEEK_THINKING=disabled
```

API Key 只从环境变量读取，禁止写入代码、文档、测试日志或提交。

---

## 七、根因排序

### P0-1：自由输入缺少通用意图绑定

当前系统只能可靠处理被 Option ID 绑定的选择。自然语言即使语义等同于已展示选项，也会被当成没有 Kernel 的 `FREE_TEXT`。

这是运行合同缺失，不是 Prompt 问题。

### P0-2：下一拍素材存在“机制丰富、戏剧场景不足”

当前包有 15 个 Decision Kernel 和 12 项需求，但只有 3 个 Narrative Scene Pattern，且编译器要求其 scope 为：

```text
PART-01 / SEC-P1-01
```

也就是说，第一节有较明确的场景写法，第二至第四节更多依赖通用机制、Floor 和 Adaptation。模型知道“下一件政策问题是什么”，却不总能知道：

- 谁主动到场；
- 谁先发难；
- 人物带来什么可见压力；
- 双方如何交锋；
- 本场应该在哪个戏剧性问题上停住。

这会让正文退化成“结算结果＋下一项待办”。

### P0-3：Reviewer 合同错误并浪费成本

Prompt 与 Parser 对 `NONE` 的定义不一致。不能靠更换模型解决。

### P1-1：分支差异过快汇合

不同选择虽然改变了当回合状态，但 Next Beat 检索主要仍由当前 Kernel 顺序推动，未充分利用：

- 玩家承担的责任；
- 已建立的证据链；
- NPC 对玩家的态度变化；
- 尚未兑现的延迟后果；
- 不同执行模式带来的现场差异。

### P1-2：受保护结果和小说表达仍有双重表达权

服务器先写一段确定性结果，Narrator 再写同一个结果，容易产生重复或报告感。

正确边界是：

- Settlement 决定事实；
- Beat Planner 决定本场戏；
- Narrator 是唯一玩家可见表达者；
- 只有真正关键且不能让模型改写的动作，才使用短小 Protected Slot；
- Fallback 是完整可读场景，不是后台规则拼接。

### P1-3：Options 正确但偏“政策菜单”

当前《桑田诏》使用 Story Package 的 authored options，保证了可执行性，却容易显示成制度条款。

正确组合是：

```text
服务器拥有真实可执行 Affordance
→ 可选的 Options Writer 只把它改写成普通玩家语言
→ 不得改变 actionId、目标、能力、事实效果和风险类别
```

### P1-4：尚无真实连续 G00—T20 玩家证据

当前结尾预览会快速结算中间回合，只能验证 Ending 合同，不等于逐屏玩完二十回合。

### P2：第二至第四部分内容缺失

第一部分完成后，第二至第四部分必须走同一套拆解和审批链。不能让 AI 根据“粮荒、毁证、御前裁决”几个标题自行续写。

---

## 八、目标模块划分

所有模块必须有清楚的输入、输出、持久化责任、失败策略和开关。

### M01：Lifecycle

```text
NEW_RUN → PROLOGUE → ACTIVE_TURN → PART_END → NEXT_PART → STORY_END
```

只管理阶段，不写剧情。

### M02：Action Gateway

负责身份、Revision、幂等、非空、输入安全和 Bound Option 校验。

### M03：Intent Resolver / Capability Binder

新模块，输入玩家自然语言，输出世界无关结构：

```json
{
  "intentType": "DEFER_EXECUTION",
  "capabilityRef": "institutional.defer_or_condition",
  "targetRefs": ["policy.reform_release"],
  "constraints": ["clarify_known_facts_first"],
  "matchedAffordanceId": null,
  "confidence": 0.91
}
```

处理规则：

1. 与当前 Affordance 语义等价：绑定现有 actionId 和 Decision Kernel；
2. 不等价但属于角色已有能力：进入通用能力结算，并检索相应 Kernel / Requirement；
3. 能力存在但目标或范围不清：要求玩家确认；
4. 越权或当前不能执行：用玩家语言解释，不创建剧情；
5. 禁止用故事专用关键词表实现。

### M04：Fact Settlement

唯一决定“事实发生了什么”。输出：

- key state patch；
- Causal Events；
- Personal / World / Delayed Echo；
- active scene transition；
- allowed / forbidden critical changes。

### M05：Critical State Store

只保存以后必须一致的信息：

- 关键人物状态与位置；
- 正式命令、承诺和权限；
- 关键文书与证据的位置、保管、公开、损毁状态；
- 秘密的知情关系；
- 关键资源；
- 已确定的延迟后果。

以下不进权威状态：灯火、衣袖、脚步、普通纸张、普通桌椅和一次性动作纹理。

一个信息符合以下任一条件，就应进入关键状态：

- 出现在玩家决策或 Settlement 中；
- 改变后续角色能力；
- 改变证据、命令、秘密或权力；
- 后续剧情必须知道它在哪里或由谁掌握；
- 再次出现时不一致会改变主线。

### M06：Story Material Retriever

只按当前 Turn 检索最小工作集：

- Part / Section Contract；
- 当前 StoryCapabilityRequirement；
- Decision Kernel；
- 相关 Source Scene Mechanism；
- Actor Policy；
- Institution Capability；
- Causal Rule；
- Evidence Profile；
- Pending Consequence；
- Approved Adaptation。

禁止把完整原著、完整世界状态或所有 Claim 塞进 Prompt。

### M07：Next Beat Planner

这是剧情质量的核心模块。它只读取结构化事实和剧情资产，不读取中文验收关键词。

统一输出：

```json
{
  "settledPlayerResult": "...",
  "initiatingActorRef": "...",
  "actorGoal": "...",
  "sceneLocationRef": "...",
  "sceneCastRefs": ["..."],
  "visiblePressure": "...",
  "countermove": "...",
  "dramaticExchange": ["..."],
  "visibleConsequence": "...",
  "dramaticQuestion": "...",
  "stopCondition": "...",
  "allowedCriticalChanges": ["..."],
  "forbiddenCriticalChanges": ["..."],
  "sourceBindings": ["..."],
  "adaptationBindings": ["..."]
}
```

最低剧情要求：

- 上一选择产生一个可见结果；
- 至少一个 NPC 主动推动；
- 至少一次人物间行动或对话交锋；
- 至少一个当前压力进入现场；
- 停在一个玩家真正可以行动的问题上。

### M08：POV Projection / Context Compiler

固定顺序：

```text
Foreground Guidance
→ Durable Memory
→ Recent Player Canon
→ This Turn
→ Reader Action
```

Reader Action 必须最后出现。

只发送：

- 当前现场；
- 当前在场人物；
- 玩家已知关键事实；
- 本轮已结算结果；
- Next Beat Plan；
- 少量 Recent Canon。

不发送：

- 已经离开当前场景但无持续作用的人物或物件；
- 完整世界状态；
- 内部 Predicate / entityId / ACL；
- Reviewer 字段；
- 验收关键词和中文同义词表；
- 施工步骤和测试规则。

### M09：Narrative Renderer

Narrator 只负责小说表达：

- 场景动作；
- 人物对话；
- 权力关系；
- 历史小说节奏；
- 自然停止点。

Narrator 不得：

- 决定新的主线；
- 再结算一次玩家行动；
- 创造关键证据、命令、秘密和角色权限；
- 输出后台规则、状态摘要或下一项工作清单。

### M10：Critical Guard / Shadow Observer

两个职责必须分开：

```text
Critical Guard：只拦五类 MVP 硬错误
Shadow Observer：记录重复、文风和普通细节，不阻断
```

Reviewer 只是可选 Observer，不是事实来源。

### M11：Atomic Commit / Memory

一次提交：

- World State Revision；
- Critical State；
- Causal / Delayed Events；
- Player Canon；
- Next Beat Trace；
- 模型调用记录；
- Review/Shadow 观察；
- Options。

只有 Canon 提交后，Storykeeper 才读取真实正文更新 Durable Memory。Storykeeper 不能重写旧 Canon 或修改 Settlement。

### M12：Options

Options 在正文提交后，根据真实结尾和服务器 Affordance 生成：

- 2—4 个真正不同的行动；
- 普通人可直接理解；
- 不显示后台代价；
- 不泄漏秘密；
- 不替玩家承诺；
- 保留自由输入。

模型只可改写显示文本，不能创造新的权威行动。

### M13：Ending

独立于普通回合。当前只处理 `PART_END`；完整 `STORY_END` 必须等第二至第四部分事实资产齐备后再裁定。

---

## 九、剧本拆解必须如何支撑下一拍剧情

### 9.1 资产层级

```text
T0 原著文本
→ T1 原著证据账本
→ T2 剧情机制与可玩能力
→ T3 明确审批的改编缺口
→ T4 运行时 Story Package
```

#### T0：原著文本

唯一作者性来源。不能把运行时 JSON 或已有游戏文案冒充原著。

#### T1：原著证据账本

保存：

- 原文范围与 hash；
- 谁在场、谁知道；
- 发生了什么；
- 哪些是客观事实；
- 哪些只是人物说法；
- 决策、反制和结果；
- sourceRefs / knownBy / confidence。

#### T2：剧情机制

不是摘要，而是回答：

- 谁为什么会主动行动；
- 他拥有什么筹码和权限；
- 玩家为什么必须决定；
- 玩家有哪些真实可行的行动；
- NPC 如何反制；
- 决定改变什么状态；
- 后果何时出现；
- 下一场为什么成立。

#### T3：Approved Adaptation

当《桑田诏》需要的具体事件在原著中没有直接出现时，必须建立改编缺口：

- 原著提供了什么机制；
- 新剧情增加了什么；
- 为什么不破坏人物、制度和因果；
- 哪些重大事实允许出现；
- 哪些事实禁止模型自行补全。

#### T4：Runtime Story Package

运行时只取当前相关的最小工作集，不取完整剧本。

### 9.2 每个 Section 必须拥有的内容

每节不能只有 Decision Kernel，还必须至少提供：

1. Section Contract；
2. StoryCapabilityRequirement；
3. 2—4 个 Source Scene / Approved Adaptation；
4. 主要 NPC Actor Policy；
5. Institution Capability；
6. 关键 Evidence Profile；
7. Causal / Delayed Consequence；
8. 2—4 个 Narrative Scene Pattern；
9. 至少一个可读 Fallback Scene Blueprint；
10. 分支状态如何影响后续检索。

当前只有第一节拥有 3 个正式 Narrative Scene Pattern。必须补齐第二、第三、第四节，而不是继续扩充 Prompt。

### 9.3 不同素材情况的统一处理

| 素材情况 | 正确处理 |
|---|---|
| 原著直接发生 | 建 T1 证据和 T2 机制，运行时可直接检索 |
| 原著没有同一事件，但有相同权力/因果机制 | 建 T3 Approved Adaptation |
| 没有原著依据，也没有批准改编 | Planner 停止并报告资产缺口，AI 不得猜 |
| 原著人物说法相互冲突 | 保存为多方 Claim 和未决事实，不合并成客观事实 |
| 关键文书、证据、秘密、承诺 | 进入 Critical State 和 Durable Event |
| 普通叙事物件 | 只做当回合文学纹理，不建 ID |
| 剧本很长 | 只检索当前 Section、Kernel、Actor 和 Pending Consequence |
| 新故事，例如凯撒 | 重用同一 Runtime Contract，只更换 Story Package |
| 玩家自由输入 | Intent Resolver 绑定能力与 Kernel，不做中文关键词匹配 |
| 不同分支重新汇合 | 可以汇合，但之前选择必须保留可见状态、关系或延迟后果 |

---

## 十、一次性收敛实施顺序

### P0：冻结基线与 DeepSeek V4-Pro

目标：确保所有人测试的是同一份代码和同一个模型。

实施：

1. 确认目标分支直接继承 `main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c`，并且开发期间始终不修改 `main`；
2. 显式配置所有已启用模型阶段为 `deepseek-v4-pro`；
3. `OPENOVEL_DEEPSEEK_THINKING=disabled`；
4. Reviewer 默认 Observe-only 或 Disabled；
5. 记录每次真实调用的 model、Token、latency、fallbackReason。

完成标准：分支基线正确；日志中不得出现 GLM 或未声明模型；Reviewer 不可用不得替换有效正文。

### P1：实现 Intent Resolver / Capability Binder

目标：选项点击和自由输入都能进入同一 Settlement / Kernel 链。

建议新增世界无关接口：

```ts
interface IntentResolverModule {
  resolve(input: IntentResolutionInput): Promise<ResolvedIntent>;
}
```

必须支持：

- 语义等价的自由输入绑定当前 Affordance；
- 角色能力范围内的新做法；
- 模糊输入返回可恢复澄清；
- 越权输入返回玩家可读拒绝；
- 不依赖故事专用词。

完成标准：当前失败输入“暂不签发，先让两边把各自知道的事说清”可生成合法 Kernel / Capability Binding，并提交 T01；第二世界 Fixture 同样通过。

### P2：修复或关闭 Reviewer 合同

目标：Reviewer 永远不是玩家看不到剧情的原因。

两种合格实现任选其一：

1. Schema 将无候选统一编码为结构化对象；或
2. Parser 明确接受唯一哨兵 `NONE`，并在内部规范化。

必须由 JSON Schema / TypeScript 类型 / Parser / Prompt 四者共同定义，禁止只改 Prompt。

MVP 可以直接关闭模型 Reviewer，只保留确定性 Critical Guard 与 Shadow 日志。

完成标准：无冲突样例不会报 `NOT_OBJECT`；Reviewer 超时、截断、坏 JSON 都只产生 advisory。

### P3：补齐每节的剧情场景资产

目标：AI 不再从政策条目猜人物和现场。

实施：

1. 为 `SEC-P1-02`、`SEC-P1-03`、`SEC-P1-04` 各补至少 2—4 个 Narrative Scene Pattern；
2. 为关键 Evidence / Document / Knowledge 链补 Evidence Profile；
3. 每个 Decision Kernel 明确：initiating actor、scene、countermove、visible consequence、stop condition；
4. 原著不足必须进入 Approved Adaptation；
5. 编译器继续强制 source/adaptation traceability。

完成标准：所有 15 个 Kernel 都能检索到剧情节拍材料，不只检索到政策规则；缺失时在模型调用前明确失败。

### P4：统一 Next Beat Plan 和单一表达权

目标：正文是完整的一场戏，不是 Settlement 与 Prompt 的拼接。

实施：

1. Settlement 只产事实；
2. Next Beat Planner 产统一结构化 `DramaticBeatPlan`；
3. Narrator 是常规回合的唯一玩家可见表达者；
4. Protected Slot 仅用于关键不可改写动作，长度最小；
5. Fallback 使用同一 DramaticBeatPlan 生成完整可读场景；
6. 不在正文前后追加后台说明、状态摘要和“下一项待办”。

完成标准：场景包含人物主动行动、交锋、可见后果和自然停止点；不会重复写两遍玩家结果。

### P5：关键状态与分支持续影响

目标：不同选择不会只影响一句正文，然后马上消失。

实施：

1. 从玩家选择和 Settlement 自动标记 Critical Facts；
2. Critical Facts 持久化到 Revision；
3. Next Beat Retriever 对关键状态、关系变化和 Pending Consequence 加权；
4. 普通纹理进入 Shadow，不写入权威状态；
5. 分支可以汇合，但必须保留至少一项持续差异。

完成标准：路径 A/B 到 T03 仍可从状态或人物反应看出此前选择，而不只是 T01 文本不同。

### P6：Options 与真实末态对齐

目标：决策可理解、可执行、真正不同。

实施：

1. Canon 原子提交后再生成 Options；
2. 服务器先给出权威 Affordance；
3. 可选 DeepSeek V4-Pro 只改写显示文字；
4. 校验每个 Option 与正文停止点、角色能力和 Kernel 对齐；
5. 保留自由输入，并交给 P1 解析。

完成标准：每回合 2—4 个行动，不显示内部代价和测试文字；任两个选项的目标或手段至少有一项实质不同。

### P7：连续玩家验收

顺序固定：

```text
工程回归
→ 全新 G00—T05
→ 玩家逐回合验收
→ 全新 G00—T20
→ 玩家逐回合验收
```

任一硬错误修复后必须从新的 G00 重跑，不能拿旧 Run 拼接。

小问题只登记到 Shadow / 质量清单，不重跑。

---

## 十一、测试矩阵和完成定义

### 11.1 工程门

只运行仓库真实存在、能命中目标 Workspace 的命令：

```text
pnpm --filter @apps/openovel-runtime typecheck
pnpm --filter @apps/openovel-runtime build
pnpm test:story:v4
pnpm --filter @apps/openovel-runtime smoke:http
```

同时重新运行第一部分资产编译，并比较 hash。

每条测试记录：

- 命令；
- Workspace；
- 总数、PASS、FAIL、SKIP/TODO；
- 退出码；
- 日志路径；
- 是否 Mock；
- 是否真实 DeepSeek V4-Pro。

以下不算通过：

- 0 tests；
- No projects matched；
- only / skip / todo；
- 包装脚本吞掉退出码；
- Mock 通过却声称真实模型通过；
- 只验证 HTTP 200；
- 只到 T05 但没人逐回合读正文。

### 11.2 必须有的通用回归

1. 推荐选项正确绑定 Kernel；
2. 语义等价自由输入正确绑定；
3. 能力内的新自由行动可结算；
4. 模糊行动可恢复，不把 Run 标成 FAILED；
5. 重复 idempotencyKey 不产生第二份 Canon；
6. Reviewer 不可用保留正文；
7. 真正关键冲突会阻止或安全降级；
8. 普通物件差异只记 Shadow；
9. Fallback 不泄漏内部说明；
10. Options 在 Canon 后生成；
11. 前一选择改变下一回合状态或 NPC 反应；
12. 第二世界 Fixture 不需要《桑田诏》专用词。

### 11.3 G00—T20 每回合玩家验收表

每回合保存：

```text
玩家看到的正文
玩家看到的决策
玩家实际选择
Settlement 关键变化
下一拍剧情计划
关键状态快照
模型与 Token/延迟
是否 Fallback
玩家评价
硬错误 / 软问题
```

每回合只问五个问题：

1. 这是一场真实发生的剧情，还是政策说明？
2. NPC 是否有自己的目标并主动行动？
3. 上一选择是否真的产生了可感知的结果？
4. 关键人物、命令、证据、秘密和位置是否一致？
5. 玩家是否看得懂并愿意选择下一步？

### 11.4 第一部分 MVP 的最终 DoD

全部满足才可以说“AI 剧情推演第一部分完成”：

- 远程与本地 `main` 基线一致；
- 所有真实模型阶段只使用 DeepSeek V4-Pro；
- G00 完整开场白只展示一次；
- 同一个全新 Run 连续完成 T01—T20；
- 每回合都有真实场景、NPC 行动、交锋和自然停止点；
- 玩家选择在后续状态或人物反应中可见；
- 关键事实无硬冲突；
- 自由输入不再因为缺 Kernel 让 Run 失败；
- 每回合选项承接真实正文末态；
- Reviewer 失败不阻断正文；
- 普通文学细节不触发硬拦截；
- T20 正确进入第一部分收束，不冒充整部故事最终结局；
- 实际模型、Token、延迟、成本和 Fallback 均有记录；
- 逐回合玩家验收通过，而不是只看自动化结果。

---

## 十二、明确禁止的实现方式

禁止：

- 为“未便遽行”“签放”“空白笺纸”等单独增加中文同义词；
- 为县册、巡抚、回文建立通用层故事专用正则；
- 每遇到一个错误就继续堆 Prompt 禁词；
- 让 Narrator 同时负责 Settlement、Next Beat、小说正文和 Options；
- 把全部原著、全部状态、全部 Claim 发给模型；
- 让 Reviewer 把普通叙事纹理升级成因果事实；
- Reviewer 不可用就丢掉可读正文；
- 模型失败时向玩家显示内部状态、规则或测试句；
- 只靠更换模型掩盖资产或合同问题；
- 用单次成功输出冒充连续玩家验收；
- 为《桑田诏》写一套无法复用于其他故事的运行时。

---

## 十三、ChatGPT Pro 分支开发与本地 Codex 验收流程

以下流程是强制流程，不能省略或调换责任：

```text
远程 main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c
        ↓
创建并推送新分支
codex/chatgpt-pro-ai-story-convergence
        ↓
ChatGPT Pro 在该分支开发、测试、提交并推送
        ↓
本地 Codex 执行 git fetch，不直接 pull 到脏 main
        ↓
在隔离环境检出该远程分支
        ↓
审查代码＋运行工程测试＋真实模型验收
        ↓
通过后才允许合并 main
        ↓
推送 main 并核对本地、origin/main、GitHub SHA 一致
```

### 13.1 阶段 A：准备远程开发分支

由本地 Codex 在仓库所有者批准后完成：

1. 再次读取 `AGENTS.md`；
2. 重新核对 GitHub `main` 仍为冻结基线；
3. 从冻结 SHA 创建 `codex/chatgpt-pro-ai-story-convergence`；
4. 推送空开发分支到 GitHub；
5. 记录远程分支初始 SHA；
6. 不切换或清理当前脏 `main`，不携带任何未提交文件。

如果同名远程分支已经存在，必须先核对其 merge-base、提交历史和文件范围；禁止 force push 覆盖未知工作。

### 13.2 阶段 B：ChatGPT Pro 开发

ChatGPT Pro 必须：

1. 只检出目标分支；
2. 按 P0—P7 分模块实施，先完成通用骨架，再补资产和真实模型验收；
3. 每个提交只包含同一模块的代码、测试和必要文档；
4. 先运行确定性工程门，再调用真实 DeepSeek；
5. 同一模块同类问题最多验证三次；第三次失败必须停止该模块并报告根因；
6. 将所有有效提交推送到同一目标分支；
7. 用 `git ls-remote origin refs/heads/codex/chatgpt-pro-ai-story-convergence` 证明最终 SHA 已到达 GitHub；
8. 最终状态只能标记为 `CANDIDATE_BRANCH_READY`，不能标记为已经合并或最终发布。

### 13.3 阶段 C：ChatGPT Pro 交付物

ChatGPT Pro 完成候选分支后必须提供：

- GitHub 仓库与目标分支；
- 基线 SHA、最终 SHA 和完整提交列表；
- `git diff --stat` 与修改文件清单；
- P0—P7 每一阶段的完成状态；
- 所有实际测试命令、Workspace、总数、PASS、FAIL、SKIP/TODO、退出码和日志路径；
- 真实 DeepSeek 的模型名、调用次数、Token、延迟、成本和 Fallback；
- G00—T05 与 G00—T20 验收 Run、逐回合记录和玩家评价；
- 三次失败停止机制是否触发，若触发则提供根因与未完成范围；
- 已知限制和未完成项；
- 明确声明未修改或推送 `main`，未修改主游戏页面、登录、积分、多人剧情和部署。

缺少最终 SHA、远程分支或测试证据时，不视为可获取的开发结果。

### 13.4 阶段 D：本地 Codex 独立复验

ChatGPT Pro 推送完成后，由本地 Codex：

1. 执行 `git fetch origin`；
2. 验证远程分支确实继承冻结基线，且没有混入无关提交；
3. 不在当前脏 `main` 上 `git pull` 或直接合并；
4. 在隔离验证环境检出远程分支的精确 SHA；
5. 审查全部 diff，重点检查故事专用正则、中文同义词、Prompt 补丁、页面改动、密钥和测试规避；
6. 独立重跑类型检查、构建、v4 测试、HTTP smoke 和资产 hash；
7. 独立验证自由输入、Reviewer 降级、关键状态、分支持续差异、Options 与末态；
8. 使用真实 DeepSeek 复跑 G00—T05，再决定是否运行 G00—T20；
9. 像玩家一样逐回合阅读正文与选择，不能只接受 Pro 的自动化结论；
10. 输出 `PASS`、`REPAIR_REQUIRED` 或 `HARD_FAIL`，并附证据。

如果本地复验失败：

```text
禁止合并 main
→ 将失败命令、日志、最小复现和模块根因交还 ChatGPT Pro
→ ChatGPT Pro 继续在同一分支修复并推送
→ 本地 Codex 获取新 SHA 后重新验证
```

同类失败最多往返三轮。第三轮仍失败，必须停止合并并向仓库所有者报告方案不成立的具体模块，不能继续小修小补。

### 13.5 阶段 E：合并与 SHA 闭环

只有本地 Codex 的独立复验通过，并获得仓库所有者最终合并授权后，才允许：

1. 将已经验证的目标分支精确 SHA 合并到 `main`；
2. 合并前再次检查当前本地脏文件是否与分支重叠；有重叠就停止，不擅自解决或覆盖；
3. 运行合并后回归；
4. 推送 `main`；
5. 核对以下三者完全一致：

```text
git rev-parse HEAD
git rev-parse origin/main
git ls-remote origin refs/heads/main
```

ChatGPT Pro 永远不能执行本阶段，也不能自行创建 PR 后合并。

---

## 十四、交给 ChatGPT Pro 的完整执行提示词

下面内容可以直接发送给具有 GitHub 仓库写权限和编码执行环境的 ChatGPT Pro。普通聊天如果不能检出、修改、提交和推送仓库，必须停止，不得把建议文本冒充开发结果。

```text
你现在是 Our Many Worlds“AI 剧情推演”候选分支的实现者。你必须直接读取仓库、修改代码、运行测试、提交并推送目标开发分支；不能只输出计划或补丁建议。

GitHub repository:
https://github.com/forwardFish/aiStoryRoom

Frozen base:
main@1b750e56858dabefb0ddb8b922c6bdcbe0574e4c

Only allowed development branch:
codex/chatgpt-pro-ai-story-convergence

Source-of-truth document:
docs/Our_Many_Worlds_AI剧情推演一次性收敛现状审计与ChatGPT_Pro开发交接方案_v1.0.md

必须先完整读取仓库根目录 AGENTS.md 和上述文档。

Git 硬规则：
1. 只能在 codex/chatgpt-pro-ai-story-convergence 开发和推送。
2. 禁止直接修改、提交、合并或推送 main。
3. 禁止创建或合并指向 main 的 PR。
4. 禁止创建第二个开发分支、force push、broad stash、git add .、git reset --hard 或 git clean。
5. 如果仓库不可访问、目标分支不存在、HEAD 不继承冻结基线或没有推送权限，立即停止并报告 REPO_WRITE_ACCESS_MISSING 或 BASELINE_MISMATCH。
6. 你的最终状态只能是 CANDIDATE_BRANCH_READY；最终验收和 main 合并由本地 Codex 负责。

编码前必须执行并报告：
git remote -v
git branch --show-current
git rev-parse HEAD
git merge-base HEAD origin/main
git status --short

你的范围仅限：
- 《桑田诏》单人 AI 剧情推演；
- 剧本资产检索；
- 玩家行动与意图绑定；
- 事实结算与关键状态；
- 下一拍剧情规划；
- 玩家安全上下文投影；
- 小说正文生成；
- 最小关键错误检查；
- 决策生成与记忆；
- G00—T20 连续验收。

不在范围：
- 主游戏页面和 UI；
- 登录、积分、Billing；
- 多人剧情；
- 部署；
- 凯撒等第二个正式故事内容；
- 已经完成的第一部分 Ending 功能，除非你的改动造成其回归。

所有真实模型调用统一使用：
- provider: https://api.deepseek.com
- model: deepseek-v4-pro
- thinking: disabled
- 禁止使用 GLM
- API Key 只读环境变量，禁止写入仓库、提交、正文或测试日志

核心产品原则：
1. AI 不猜下一步剧情；下一拍必须来自剧本资产＋权威状态＋NPC 目标＋玩家选择。
2. 玩家看到的是小说剧情，不是 Settlement 摘要、指令清单或下一项待办。
3. 关键人物、位置、命令、证据、文书、秘密、承诺和关键资源必须持续一致。
4. 普通文学纹理和非关键细节只记录，不阻断 MVP。
5. 玩家选择必须改变下一回合状态、NPC 行为或延迟后果。
6. Narrator 和 Options 分开；Settlement 是唯一事实来源。
7. 模块必须可插拔；Optional 模块失败不能拖垮完整流程。
8. 禁止增加《桑田诏》中文同义词、故事专用正则和单场 Prompt 例外。
9. 同一模块同类失败最多验证三次；第三次仍失败就停止、报告架构根因并改变方案。

严格按文档 P0—P7 分模块实施：
P0 冻结分支基线和 DeepSeek V4-Pro；
P1 实现世界无关 Intent Resolver / Capability Binder；
P2 修复或关闭 Reviewer 的 NONE/对象合同冲突；
P3 补齐第一部分四节的 Narrative Scene Pattern 和关键 Evidence Profile；
P4 统一 DramaticBeatPlan，让 Narrator 成为常规正文的唯一表达者；
P5 让关键状态和延迟后果维持分支差异；
P6 Options 在 Canon 后基于权威 Affordance 生成玩家语言；
P7 全新 G00—T05，再全新 G00—T20 逐回合玩家验收。

必须首先复现自由输入错误：
“暂不签发，先让两边把各自知道的事说清。”
当前历史错误为 PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING。
修复必须使用结构化意图/能力绑定，禁止使用中文关键词或同义词映射。

必须修复或关闭 Reviewer 合同冲突：
Prompt 历史上要求无候选返回 NONE，Parser 却要求对象，导致 SCENE_REVIEW_INVALID:P0_causalIntroduction_NOT_OBJECT。
Reviewer 不可用不是事实冲突，不得替换有效正文。

工程门至少包括：
- pnpm --filter @apps/openovel-runtime typecheck
- pnpm --filter @apps/openovel-runtime build
- pnpm test:story:v4
- pnpm --filter @apps/openovel-runtime smoke:http
- 第一部分资产无回写重新编译并比较 hash

不要直接相信文档中的历史测试数。你必须记录每条当前实际执行命令的 Workspace、总数、PASS、FAIL、SKIP/TODO、退出码、日志路径以及是否使用 Mock 或真实模型。

真实验收必须保存：
- G00—T20 每回合正文、决策和玩家选择；
- Settlement 关键变化；
- 下一拍计划；
- 关键状态快照；
- 模型名称、Token、延迟、成本和 Fallback；
- 每回合玩家评价；
- 硬错误和仅记录的软问题。

开始实现前先输出：
1. 仓库、目标分支、当前 HEAD 和 merge-base；
2. 当前模块与文档的差异；
3. P0—P7 的文件级修改计划；
4. 如何证明实现不是《桑田诏》专用补丁；
5. 哪些当前文件已有改动，以及你如何避免覆盖无关工作。

然后直接按阶段实现、测试、显式暂存相关文件、提交并推送同一目标分支。不要等待用户逐步催促；但同类失败达到三次时必须停止该模块并报告。

最终交付必须包含：
- 状态 CANDIDATE_BRANCH_READY；
- 目标分支、冻结基线 SHA、最终 SHA、提交列表；
- git ls-remote 对目标远程分支的最终 SHA 回读；
- 修改文件和 diff stat；
- P0—P7 完成矩阵；
- 工程测试与真实模型验收证据；
- G00—T05、G00—T20 玩家验收材料；
- 三次失败停止记录；
- 已知限制和未完成项；
- 明确声明没有修改、合并或推送 main。
```

---

## 十五、最终产品判断

DeepSeek V4-Pro 不是当前最大的阻塞。真实 T01—T03 已经证明：当下一拍、关键事实和人物边界清楚时，它能够写出合格的历史政治小说场景。

当前真正需要一次性解决的是四个合同：

```text
自由语言如何绑定可执行意图
→ 剧本素材如何明确提供下一拍戏剧节拍
→ 关键状态如何持续影响分支
→ Narrator 如何只负责小说表达
```

Reviewer、文风细节和普通物件一致性都应放到第二优先级。只要五项 MVP 玩家标准成立，就先让玩家完整体验，再逐模块优化。

第一部分完成后，后续故事的正确扩展方式是：

```text
新增 T0—T4 故事资产
→ 通过同一编译器和合同
→ 使用同一个通用运行时
→ 不修改核心代码
```

这才是能够反复用于《桑田诏》、凯撒和其他世界的通用剧情推演系统。
