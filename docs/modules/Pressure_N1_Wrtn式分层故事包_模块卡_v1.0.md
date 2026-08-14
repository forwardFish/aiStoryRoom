# Pressure N1 Wrtn 式分层故事包模块卡 v1.0

## 批准目标

将 N1 已有材料整理成十层 MVP 故事包，由同一个 DeepSeek Provider 分别生成连续剧情和三个合法决策表达。N1 通过后立即停止，不扩展 N2-N7。

## 模块 1：分层故事包合同

- 唯一责任：把现有权威材料按用途分层，不生成文字、不修改状态。
- 输入：桑田 Story Package、N1 scene-flow、viewer seat、sealed action、viewer-safe actions、WorkingDelta/stateAfter、allowedClaims、nextDecisionPin、Catalog。
- 输出：Prompt 模板、世界文风、用户身份、人物规则、开场设置、示例对话、真实当前状态、上一段剧情、玩家输入、输出要求。
- 权威顺序：真实当前状态 > 玩家输入 > 上一段剧情（仅连续性） > 开场材料 > 身份与文风 > 示例语气。
- 禁止：数据库、持久记忆、关键词检索、从 Narrative 反推结算、读取其他席位秘密。
- 失败归属：缺层、重复来源、超过故事包预算由本模块负责，Provider 不调用。
- 回滚：移除分层编译字段，恢复现有 authored fallback；Settlement 和游戏状态不受影响。

## 模块 2：剧情生成

- 唯一责任：让玩家输入先在现场真实发生，再根据权威结果和未解决压力续写。
- 输入：模块 1 的故事包与既有 authority envelope。
- 输出：`text`、`usedFactRefs`、`claims`。
- 必须：低风险自由行动真实发生；使用当前身份语气；回到仍未解决的 Pressure；required claim 保持事实一致。
- 禁止：工程语言、虚构灾情、虚构代价、夸大玩家单独贡献、列出决策选项。
- 失败归属：HTTP/JSON/生成越权由 Provider/Truth Guard 负责，使用既有冻结回退。
- 回滚：仅回滚 Prompt Builder 接线。

## 模块 3：决策表达

- 唯一责任：承接上一段剧情，把现有三个 Catalog 行动改写成当下自然问题与选项文案。
- 输入：上一段发布 Narrative、N1 当前场景、viewer-safe 状态、当前玩家身份和三份 legal action contract。
- 输出：`sceneText`、`question`、三项 `actionType/label/description`。
- 必须：actionType 集合逐项一致；页面仍保留独立自由输入。
- 禁止：新增/删除/合并行动；从身份背景、历史常识或想象推导代价；保证行动结果。
- 失败归属：集合、长度或安全校验失败由本模块整份回退，不部分拼接。
- 回滚：关闭 decision presentation Provider，仍显示 Catalog 冻结文案。

## 模块 4：六身份语言示例

- 唯一责任：约束当前玩家角色的说话节奏、观察方式和权力边界。
- 来源：本地《大明王朝1566》只用于人工提炼语言指纹；运行时使用原创示例，不传原著全文或原句。
- 每个身份六类：冷静追问、与幕僚商议、对同级施压、对下属下令、动怒但守身份边界、调侃/讥讽/疲惫。
- 运行时只加载当前 viewer seat 的六条原创示例，不读取其他身份的示例。
- 禁止：把示例当成事实、效果、代价、固定选择或必须复现的对白。
- 失败归属：身份错配、示例缺失或内容越权由 Story Source 校验负责。

## 玩家参与门

1. 每个模块 focused tests 单独通过。
2. API typecheck 和 Pressure Narrative 权威测试通过。
3. Codex 最多进行三次真实 `deepseek-v4-pro` 测试；一旦通过立即停止。
4. 交付完整故事包来源日志、原始剧情和三个决策给项目所有者判断。
5. 未经项目所有者认可，不进入 N2-N7，不提交、不推送、不部署。
