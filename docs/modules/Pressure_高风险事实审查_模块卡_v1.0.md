# Pressure 高风险事实审查模块卡 v1.0

## 单一职责

在AI生成Pressure剧情后，提取并审查可能改变持久世界状态的高风险断言；普通文学纹理不属于阻断范围。

## 不负责

- 不检查或改写普通动作、神情、灯影、脚步、无名路人及不改变状态的对白。
- 不要求普通工具、物资名称、无名执行者或不影响结算的相对时间逐项出现在权威数据中。
- 不决定行动效果、六席结算、章节推进、文风和选项内容。
- 不修改Pressure Spine、Catalog、数据库、API或玩家页面。
- 不包含章节名、故事名、角色名、行动类型或中文关键词黑名单。

## 权威输入与输出

- 输入：通用分层故事包、观众安全的权威事实、AI剧情候选。
- 输出：未获权威支持的持久事实片段、缺失的必要事实语义；仅高风险冲突阻断。
- 权威事实仍只来自`NarrativeContextV1`；Reviewer没有状态写入权。

## 高风险范围

- 灾情与伤亡结果、被跟踪资源的增减和转移、证据存在真伪与保管、关系的持久变化。
- 新的正式命令、承诺、决定或玩家未选择的行动。
- 新的持久人物、秘密、因果归属或量化结果。
- 权威要求在本轮可见、但正文语义上完全缺失的结果。

## 文学纹理与持久事实边界

- 删除某个细节后，如果结算、资源账、灾情、证据状态、责任、关系、行动完成度和节点推进均不改变，该细节默认属于文学纹理。
- 已授权行动可以自然表现为普通人员、工具、物资、动作和相对时间流逝；这些内容保留在Narrative中用于阅读与连续感，但不写回权威状态。
- 完整Narrative可以持久化为展示文本；下一轮权威事实仍只能重新从sealed action、WorkingDelta、stateAfter和allowedClaims编译，不从Narrative正文反推。

## 依赖与单向关系

`权威状态 -> 故事包编译器 -> Narrator -> 高风险Reviewer -> 现有Truth Guard -> Publisher`

Reviewer不得反向修改故事包、结算或权威状态；普通叙事纹理直接保留。

## 准确文件

- `apps/api/src/pressure-chapter/production-config/pressure-narrative-truth-review.ts`
- `apps/api/src/pressure-chapter/production-config/narrative-provider.ts`
- `apps/api/src/pressure-chapter/production-config/pressure-prompt-layers.ts`
- `apps/openovel-runtime/src/pressure-narrative/truth-guard.ts`
- 对应focused tests与本地真实模型smoke

## 失败归属与回滚

- 无权威支持的持久事实未拦截：本模块负责。
- 普通文学纹理被错误拦截：本模块负责，必须收窄观察范围。
- 文风不好但持久事实正确：Narrator提示词或内容材料负责。
- 回滚只移除内部Reviewer接线，不改公共合同、数据、页面或Settlement。

## 验收门

1. 普通文学纹理可以通过，高风险状态变化必须有权威支持。
2. 必要事实可以自然改写，不要求权威原句逐字出现在正文。
3. 模块与测试不包含N1或任何故事专用词。
4. 真实模型输出同时具备连续场景、事实正确和自然决策表达。
