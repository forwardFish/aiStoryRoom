# C-2 main game page constraint

新增仓库所有者硬约束：不能随意修改页面内容，特别是主游戏页面。测试必须基于实际页面，不得通过新增或修改测试页面来证明功能。

请据此调整 C-2：

- 不新增测试专用页面、平行 OpenNovel 主游戏页、内嵌 toy HTML、测试专用 DOM 控件或替代主界面的注入面板。
- 不接受 C-1 的额外 `openovel-role-chrome` 作为平行主界面。OpenNovel 状态必须尽量映射到现有 `/game` 的剧情区、状态区、Options、自由输入、互动与控制组件，复用现有 render 生命周期和视觉样式。
- 只有 v1.0 明确要求且现有组件/插槽确实无法表达的状态，才允许做最小、视觉一致的现有组件扩展；必须说明对应 requirement，并增加普通 V2/Solo 与现有 Web 快照/行为回归。
- unit 可使用 fixture，但 browser/E2E/player-quality 必须启动并操作仓库真实 `/game` 页面、真实 Web/API/隔离数据库和三个独立会话。
- 最终 M11 还将由仓库所有者亲自参与总督、巡抚、县令三个真实角色会话；没有所有者明确 sign-off 不能完成。

继续 C-2 时把这一约束作为设计边界，不要继续构建平行 UI。
