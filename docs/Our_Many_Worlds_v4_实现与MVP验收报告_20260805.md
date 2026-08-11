# Our Many Worlds v4 实现与 MVP 验收报告（2026-08-05）

## 1. 报告结论

当前 `main` 已经形成世界无关、可替换的剧情运行链，并完成《桑田诏》同一冻结版本 G00—T05 的真实 DeepSeek 连续预验收。

本轮可以确认：

- 主体架构已经完成并串通；
- 《桑田诏》单人 MVP 的剧情、决策、关键状态和原子提交可以连续运行；
- T03 曾因无害的模型槽位偏差错误进入 Fallback，现已通过通用传输合同修复；
- 修复没有加入中文同义词、故事专用正则或《桑田诏》分支；
- 当前 G00—T05 达到 Codex 玩家预验收标准，但尚不能替代用户本人或独立新上下文的正式盲测；
- 完整 v4.0 的双世界真实模型、三条 T10、一条正式 T20、真实三玩家和上线证据仍未闭环，因此整份 v4.0 不能标记完成。

原始总纲来自归档分支：

- `codex/workspace-residual-20260805:docs/Our_Many_Worlds_多人剧情生成系统完整实现方案_v4.0_双代理执行版.md`
- SHA-256：`EA2FC29D87336DB7692CC2A2994F9B328A22FC651AB96A1E6EBC04737A7CC619`

## 2. 当前 MVP 验收原则

本阶段按用户冻结的顺序验收：

1. 主线和人物行为合理；
2. 玩家选择真实改变后续；
3. 关键事实前后一致；
4. 决策清楚且确实不同；
5. 文本整体流畅。

非关键舞台动作、临时道具和轻微措辞漂移可以记录，但不阻断 MVP。正式命令、关键文书、证据、秘密、关键人物状态和玩家承诺仍属于关键事实。

## 3. 模块化运行链

| 模块 | 职责 | 当前状态 |
|---|---|---|
| Action Gateway | 身份、Revision、幂等、行动绑定和能力前置校验 | 已实现 |
| Settlement | 结构化因果结算、状态迁移和三个回响 | 已实现 |
| Delayed Event | 延迟后果持久化、到期、取消、重放 | 已实现 |
| Next Beat Planner | 只依据结构化状态选择下一拍 | 已实现 |
| Player Projection | 私密、公共、可推测信息和可见实体隔离 | 已实现 |
| Context Compiler | Foreground、Memory、Recent Canon、This Turn、Reader Action | 已实现 |
| Scene Render Planner | Protected Scene、Open Scene 和 Fallback 选择 | 已实现 |
| Narrative Renderer | 只负责小说表达，不决定关键事实 | 已实现 |
| Truth Observer / Policy | Reviewer 观察与可插拔发布策略 | 已实现；模型结构质量仍可优化 |
| Surface Guard | 空文本、协议泄漏、严重截断等表面安全 | 已实现 |
| Atomic Committer | 状态、事件、正文、选项和 Head 原子提交 | 已实现 |
| Options / Storykeeper | Canon 后选项、长期工作集和延迟后果维护 | 已实现 |
| Ending | 由权威终局状态生成结局和人物命运 | 已实现 |
| World Registry | 同一核心加载《桑田诏》和第二世界 Fixture | 已实现 |

模块通过 `TurnModuleRegistry` 使用 `REQUIRED`、`OPTIONAL`、`DISABLED` 和 `FALLBACK_ONLY` 模式，可独立替换、关闭或降级。

## 4. 本轮通用修复

### 4.1 真实故障

首条真实 Run：

`sangtian_deepseek_current_g00_t03_20260805_01`

T03 的 DeepSeek 原稿包含完整人物反应和复核权交锋，但额外返回了一个 `REACTION_WINDOW` 槽位，同时重复返回服务器拥有的 `PLAYER_RESULT` 和 `SCENE_TRANSITION`。旧传输合同把未知槽位当作致命错误，最终用简短 Fallback 替换整幕。

### 4.2 根因

问题位于 Scene Draft 模型传输边界，不在剧情资产、Settlement 或 DeepSeek 文风：

- 模型输出中无权威性的额外槽位被错误升级为整幕失败；
- 模型重复返回受保护槽位时，系统没有直接丢弃无权威副本；
- 结果是“系统识别到一个非关键格式偏差，却删除了正常小说正文”。

### 4.3 通用处理

- 未知模型槽位在传输层丢弃，不进入 Canon 或状态；
- 服务器受保护槽位始终覆盖模型副本；
- 缺失真正必需槽位、非法转场、关键状态冲突仍严格失败；
- 对象形式和槽位列表形式使用同一规则；
- 用《桑田诏》和《凯撒》两个世界名称验证同一合同；
- 未增加自然语言同义词、关键词白名单或剧情专用分支。

修改文件：

- `apps/openovel-runtime/src/scene-draft-transport.ts`
- `apps/openovel-runtime/src/scene-pipeline.ts`
- `apps/openovel-runtime/tests/scene-pipeline.spec.ts`

## 5. 工程测试证据

| 命令 | 结果 |
|---|---|
| `pnpm --filter @apps/openovel-runtime typecheck` | PASS |
| Scene Pipeline 专项测试 | 12/12 PASS，0 skip/todo |
| `pnpm test:openovel-runtime` | 222/222 PASS，0 fail/skip/todo |
| `pnpm test:story:v4` | 330/330 PASS，0 fail/skip/todo |
| OpenNovel Runtime build | PASS |

`330` 项由 80 项 Runtime Contract、28 项 Story Package 和 222 项 OpenNovel Runtime 测试组成。它覆盖双世界合同、因果结算、投影、隐私、并发、原子 Head、Fallback、Reviewer、Storykeeper、共享世界和确定性 T20。

## 6. 真实 DeepSeek G00—T05 预验收

冻结条件：

- Run：`sangtian_deepseek_current_g00_t03_20260805_02`
- Provider：官方 DeepSeek 地址；
- Model：`deepseek-v4-pro`；
- Reviewer：`OBSERVE`，只记录不阻断；
- Storykeeper：启用；
- 同一 Run、同一配置连续推进到 T05；
- 未修改主游戏页面。

### 6.1 逐回合结论

| 检查点 | 玩家选择与剧情结果 | 评价 |
|---|---|---|
| G00 | 两封文书、一道急令 | 固定开场，建立急令、密信和三日压力 |
| T01 | 封档并暂缓签发 | 有现场、书吏反制和真实边界问题，PASS |
| T02 | 清流有限试办并禁止趁急难压价买田 | 选择进入正式回文和责任争夺；匣子意象略重复，PASS_WITH_NOTE |
| T03 | 要求巡抚共同具名 | 巡抚拒签，转入次日复核权争夺；人物交锋完整，PASS |
| T04 | 总督府主持复核 | 县令与巡抚幕僚围绕原册、抄件和保管责任交锋，PASS_WITH_NOTE |
| T05 | 原册留在档房，三方到场后换封 | 原册位置、保管人和“命令已发但换封未完成”一致；经手书吏成为下一决策焦点，PASS_WITH_NOTE |

非阻断备注：

- T02 有轻度动作和意象重复；
- T04 出现仅在本幕使用的“备忘录”舞台道具，它没有进入 Settlement、后续状态或选项；
- T05 对书吏知道的册页异常描写比资产授权略具体，但没有形成页码、正式证据、幕后定罪或持久状态；
- Reviewer 两回合返回无效结构，系统按合同安全降级，没有制造 P0；后续可优化 Reviewer 模型或结构化响应，不阻断当前 MVP。

### 6.2 关键状态读回

T05 后：

- Durable Revision 连续递增到 5；
- 每回合均为 `USE_ORIGINAL`，没有使用 Fallback；
- 每回合一个 Narrator 调用和一个 Reviewer 调用；
- Storykeeper 已处理 5 个回合；
- 清流县册原件仍在清流县档房；
- 原件保管人为清流县令；
- 换封状态为已下令、尚未执行；
- 巡抚拒绝共同具名已经成为已结算 NPC 反制；
- 当前选择点为改桑书吏的接触与问询方式。

这证明当前主线不是“不断发送命令”：玩家行动会引出 NPC 的拒绝、反制、责任转移、证据保管争夺和新的现场压力。

## 7. Phase 0—10 状态

| Phase | 当前状态 | 尚缺内容 |
|---|---|---|
| Phase 0 基线与可信测试门 | 已完成 | 历史证据只作为审计材料，不代表玩家通过 |
| Phase 1 世界无关合同 | 已完成 | 无当前阻断 |
| Phase 2 确定性结算与三个回响 | 已完成 | 无当前阻断 |
| Phase 3 移除词法硬门与故事分支 | 已完成 | 旧诊断保留为离线、默认不参与发布 |
| Phase 4 Reviewer / Comparator / Disposition | 工程完成 | Reviewer 实际模型结构稳定性可继续优化 |
| Phase 5 Narrator 工作集 | 已完成 | 文风和重复属于持续质量优化 |
| Phase 6 多人投影与命运网 | 工程完成 | 真实三玩家人工体验尚缺 |
| Phase 7 双世界工程验证 | 已完成 | 两个世界同一自动化矩阵通过 |
| Phase 8 有限真实模型验证 | 部分完成 | 《桑田诏》G00—T05 已有；按用户要求暂不做《凯撒》真实模型；三条 T10 和正式 T20 尚缺 |
| Phase 9 真实玩家验收 | 部分完成 | Codex 玩家预验收已完成；用户本人或独立新上下文六屏盲测尚缺 |
| Phase 10 产品存储与正式集成 | 部分完成 | DB/API、队列、指标和开关已有；完整灰度、回滚和发布候选验收尚缺 |

## 8. 24 项交付物状态

| # | 交付物 | 状态 |
|---:|---|---|
| 1 | WorldRuntimeContract Schema | 完成 |
| 2 | Durable Predicate Schema | 完成 |
| 3 | Durable Turn Envelope | 完成 |
| 4 | Generic Settlement Engine | 完成 |
| 5 | Causal Event / Delayed Event | 完成 |
| 6 | Player Projection Compiler | 完成 |
| 7 | 世界 Canon / 玩家 POV Canon | 完成 |
| 8 | Truth Reviewer | 工程完成，模型结构稳定性待优化 |
| 9 | Predicate Comparator | 完成 |
| 10 | 通用 Surface Guard | 完成 |
| 11 | Narrator 工作集 | 完成 |
| 12 | Options / Storykeeper | 完成 |
| 13 | 《桑田诏》Story Package / Fixture | 完成 |
| 14 | 《凯撒》Story Package / Fixture | 工程 Fixture 完成；真实模型按用户要求暂缓 |
| 15 | 三玩家多轮集成场景 | 自动化完成；真实玩家验收尚缺 |
| 16 | 隐私、安全投影和并发测试 | 完成 |
| 17 | 历史失败回归语料 | 完成 |
| 18 | 双世界真实模型记录 | 部分完成，仅《桑田诏》 |
| 19 | G00—T05 玩家验收记录 | Codex 预验收完成；独立玩家记录尚缺 |
| 20 | T10/T20 稳定性报告 | 未完成；现有快速 T20 仅验证结构和结局方向 |
| 21 | Token、延迟、成本账本 | 调用与 Token/延迟已持久化；正式价格汇总待补 |
| 22 | 架构决定和迁移说明 | 完成 |
| 23 | Protected Beat / Repair / Fallback 资产与证据 | 完成 |
| 24 | 双代理开发与独立验收归档 | 部分完成，尚未形成最终交付包 |

## 9. 快速结局测试边界

`scripts/acceptance/sangtian-part-one-ending-preview.mts` 可以：

1. 用结构化 Settlement 快进中间状态；
2. 到 T20 后依据最终权威状态生成 Ending；
3. 检查 Revision、`HANDOFF_READY`、空 Options、人物命运和 aftermath。

它不能：

- 替代正常产品逐回合流程；
- 证明 T06—T20 每回合小说质量；
- 代替三条独立 T10 和一条真实 T20；
- 代替玩家逐屏验收。

历史快速结局 `sangtian_ending_preview_1785906626001` 已证明终局结构可达，但不计为 Phase 8/9 正式通过。

## 10. 当前结论与下一步

《桑田诏》单人 MVP 的主体架构和 G00—T05 连续剧情已经达到可交给用户亲自测试的状态。当前不需要继续针对每个中文表达修补，也不需要修改主游戏页面。

下一步顺序：

1. 将本轮通用修复和报告提交到 `main`；
2. 通过现有真实主游戏流程由用户进行 G00—T05 体验，不新增测试 UI；
3. 根据玩家反馈只定位对应模块，不跨模块修补；
4. 玩家通过后再执行三条 T10 和一条真实 T20；
5. 按用户后续安排再恢复《凯撒》和真实三玩家验收；
6. 最后冻结单一发布 SHA，完成 DB、API、UI、灰度、回滚和生产证据。

在上述缺口完成前，结论是：

> 《桑田诏》单人 MVP 可进入用户测试；完整 v4.0 仍在收尾，不能宣称正式上线完成。
