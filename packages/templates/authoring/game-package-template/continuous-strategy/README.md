# 正式运行剧本目录

这里保存引擎实际读取的七轮连续策略 JSON，不是页面文案备忘录。

固定关系：

- `stages.json`：七轮公共局势、事实、资源、互动请求和系统行动引用。
- `role-stage-content.json`：每个角色在每一轮的私密信息和 3 张主行动卡。
- `maneuver-strategies.json`：每个角色每轮可执行的主动谋划。
- `reaction-scenarios.json`：定向互动的触发条件和回应选项。
- `system-actions.json`：世界角色每轮自动执行的动作。
- `agent-policies.json`：AI Agent 对每个角色、每一轮的目标和选择策略。
- `result-rules.json`：每轮公共结果与个人结果的生成规则。
- `ending-rules.json`：共同结局和每个角色个人结局规则。
- `manifest.json`：上述文件及 Schema 的 SHA-256 清单。
- `schemas/`：当前内容版本使用的严格 JSON Schema。

模板中的空数组只表示待创作，不能直接发布。正式内容必须满足：

- 7 个阶段。
- 每个角色 × 7 个阶段均有内容。
- 每个角色阶段严格 3 张主行动卡。
- 每个玩家角色都有 AI policy 和个人结局。
- `game.json`、所有剧本 JSON 和 Manifest 使用同一个 `contentVersion`。
- 重新计算所有文件 SHA-256，并把 Manifest 哈希写回 `strategy-registry.json`。

可参考完整样板：`packages/templates/config/sangtian/continuous-strategy-v1.2/`。
