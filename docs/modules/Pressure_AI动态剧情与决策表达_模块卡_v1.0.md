# Pressure AI 动态剧情与决策表达模块卡 v1.0

## 本轮产品边界

- 四段统一开场白继续使用已冻结内容，不调用大模型。
- 从 N1 第一段现场开始，玩家看到的决策前剧情、决策问题和建议选项文案由 AI 根据当前真实投影生成。
- Pressure Spine 只规定当前核心压力与推进方向；`scene-flow.json` 是生成素材，不再直接作为玩家正文。
- Catalog 只规定合法 `actionType`、规则效果和回退文案；AI 不得新增、删除或替换行动类型。
- N1 玩家界面显示三个正式行动建议，`DEFAULT_PASS` 只保留为内部默认能力；第四种入口是玩家自由输入。
- 不新增数据库表、migration、API 路由、页面、状态机或 Worker；不修改 Settlement、Progress Gate 和三栏布局。

## 模块 A：决策上下文编译器

- 唯一职责：把已经过权限过滤的当前章节、角色、指标、资源、当前 Narrative、Pressure 场景素材和 Catalog 合法行动组成只读上下文。
- 权威输入：`PressureGameChapterSourceV1`、Viewer/World/Narrative 安全投影、Catalog 投影。
- 输出：带 `contextHash` 的 `PressureDecisionPresentationContextV1`。
- 禁止：读取其他席位私密信息、修改权威状态、从 AI 文本反推结算事实。
- 失败归属：输入缺失、越权或 hash 不一致由本模块负责，回退到 Catalog/Pressure 原文。

## 模块 B：AI 决策表达 Provider

- 唯一职责：根据模块 A 的上下文生成连续剧情、当前问题及每个合法行动的自然表达。
- 输出只允许：`sceneText`、`question`、`options[].actionType/label/description`。
- AI 无权输出：规则效果、结算结果、下一节点、私密事实或新的 `actionType`。
- 缓存键：`contextHash`；同一真实状态重复读取不重复调用模型。
- 失败归属：超时、HTTP、无效 JSON 由 Provider 负责，调用方立即使用回退文案。

## 模块 C：表达校验与绑定

- 唯一职责：校验 AI 输出并按 `actionType` 重新绑定到原 Catalog 选项。
- 必须满足：选项数量一致、`actionType` 集合完全一致且不重复、字段非空、长度受限、无工程字段和虚假保证。
- 只覆盖玩家文案：`decision.summary/title/options.label/options.description`。
- 不覆盖：`code/actionType/preferredEntry/expectedWorkingRevision/requirement`。
- 失败归属：任何不一致均由本模块拒绝整份生成结果，不做部分拼接。

## 模块 D：自由输入 Action Guard

- 唯一职责：把玩家自由输入确定性匹配到当前 Catalog 已有合法行动；模糊或越界时拒绝。
- 不调用 Narrative AI，不允许产生新的规则效果。
- N1 首轮先支持与三个正式行动语义一致的自由表达；无法唯一绑定时要求玩家改写或直接选择建议行动。
- 失败归属：匹配不唯一、无合法行动或宣告结果由 Action Guard 负责，Settlement 不接收未绑定输入。

## 测试与玩家参与门

1. 单元测试证明 Provider 只收到 viewer-safe 数据，AI 选项不能改变 Catalog 行动集合。
2. 单元测试证明模型失败/输出越权时完整回退，`/game` 仍可玩。
3. 单元测试证明 N1 只显示三个正式行动建议，并保留独立自由输入入口。
4. Codex 只完成一次真实生成自测，并打印故事包来源与生成结果日志。
5. 第二个新 Run 立即交给项目所有者，从统一开场白开始亲自测试。
6. 本轮只验收 N1；未获认可不继续扩展 N2-N7 内容。
