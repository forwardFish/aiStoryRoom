# Pressure N1 通用场景编译纵切模块卡 v1.0

## 批准范围

- 系统改善 N1 `scene-flow.json` 中玩家可见的场景文本。
- 将 N1 专用内容读取与故事包代码重构为通用场景编译器。
- 通用编译器当前只启用 N1；N2—N7 不读取、不改文案、不进入真实流程。
- 不修改 JSON schema、场景 ID、图关系、可见权限、来源引用、行动规则、结算条件、数据库或路由。

## 模块 A：作者场景内容

- 唯一职责：提供人物动作、对白、消息冲突和逼近决策的 N1 场景文本。
- 权威输入：`packages/templates/config/sangtian/pressure-spine-v1.0/source/nodes/N1/scene-flow.json`。
- 输出：保持原结构与元数据不变的 N1 玩家可见文本。
- 失败归属：内容不自然、不连贯或不像人物说话时，只修本模块文本。
- 回滚：恢复 N1 `title/text` 与对应内容包 hash 元数据。

## 模块 B：通用场景源读取器

- 唯一职责：按 `chapterId + viewerSeatId` 从 hash-verified Pressure Spine 选择公共现场、当前席位私人视角、紧迫事件、人物规则与世界文风。
- 不负责：六席行动、结算、权限推断、模型生成或页面渲染。
- 输入：Pressure Spine、席位目录、人物目录、节点 `scene-flow.json` 和 `seat-content.json`。
- 输出：`SangtianPressureStorySourceV1`。
- 失败归属：缺少唯一场景、席位或人物时由读取器 fail closed。

## 模块 C：通用决策故事包编译器

- 唯一职责：将模块 B 的冻结内容与已经 audience-safe 的 Narrative Context 组成一个 Narrator 故事包。
- 不负责：回读数据库、改变 Settlement、替 AI 席位做决策或发明事实。
- 输入：`NarrativeContextV1` 与模块 B 输出。
- 输出：`PressureDecisionStoryPackV1`，受 8 KB、required claims 和未解决压力数量限制。
- 启用门：`ENABLED_PRESSURE_STORY_PACK_CHAPTERS_V1 = { N1 }`。
- 失败归属：材料缺失、预算超限或事实锚点不唯一时由本模块 fail closed。

## 模块 D：Provider 接线与日志

- 唯一职责：把同一个 `{ storyPack, authority }` 交给现有 Narrator，并按 `off|summary|full` 输出开发日志。
- 不负责：增加模型调用次数、改变事实权威或把调试字段显示给玩家。
- 环境变量：`PRESSURE_DECISION_STORY_PACK_LOG`；兼容现有本地 N1 变量仅用于过渡。

## 聚焦验收

1. 内容包 hash、图关系、权限、来源和 schema 校验通过。
2. 六个席位均能由同一个通用读取器获得三段 N1 决策前现场。
3. 只有 N1 BEAT 生成通用故事包，N2 与章节级 Narrative 返回 `null`。
4. 故事包仍只含玩家可见行动、真实结果和真实未解决压力。
5. 真实 `/game` 保留完整开场白，并在同页展示具体 N1 现场、决策标题和说明。
6. Codex 只跑一次完整真实流程；下一次新 Run 直接交给项目所有者参与测试。
