# Pressure 共同开场与席位 N1 流程模块卡

- 任务：恢复 `/game` 标准流程：全员相同的长共同开场白 -> 当前角色专属 N1 局势剧情 -> 第一次决策。
- 批准来源：项目所有者在 2026-08-15 当前对话中明确要求按该流程修改。
- 编排方式：`serial-fallback`；这是单一投影边界的窄修复，不启动并行写代理。

## 职责

- 在玩家投影边界固定 `GENESIS_NARRATIVE` 的可见文本为 `story-package/opening.json.prologueNarrative`。
- 保留现有“进入局势”和“进入决策”两道交互门。
- 保证进入局势后展示当前 `viewer.seatId` 对应的 N1 决策场景。

## 非职责

- 不修改六个角色的 N1 作者文本。
- 不修改个人资源、个人指标或结算规则。
- 不修改数据库结构、路由、公开 API 合同或 Genesis 异步生产/持久化管线。
- 不修改 `/game` 三栏布局、样式、按钮文案或其他玩家页面。

## 单一权威与依赖方向

`opening.json.prologueNarrative` -> 共享 Genesis 玩家开场投影函数 -> `REPLAY`/`FAST` 两种读取模式 -> `pressure_chapter_game_projection_v1.narrative.text` -> 既有 `/game` 开场渲染。

角色 N1 沿既有路径独立投影：当前席位决策场景 -> `decision.summary` -> `decisionNarrative`。

异步 Genesis 投影仍可写入数据库并接受完整性校验，但不再覆盖已经批准的共同开场文案。

## 准确文件

- `apps/api/src/pressure-chapter/live-adapters/narrative.adapter.ts`
- `apps/api/src/pressure-chapter/live-adapters/live-adapters.api.spec.ts`
- `apps/api/src/pressure-chapter/game-projection/shared-genesis-opening.ts`
- `apps/api/src/pressure-chapter/game-projection/game-projection.service.ts`
- `apps/api/src/pressure-chapter/game-projection/game-projection.service.spec.ts`
- `apps/web/tests/pressure-chapter-game-v1.pressure-chapter.browser.test.mjs`（仅执行既有回归，不修改）

## 输入与输出

- 输入：N1 Genesis commit、当前席位、可能存在的异步 Genesis 投影行。
- 输出：通过既有合同返回、对所有席位一致的完整共同开场；随后由现有页面状态机展示当前席位 N1 和决策。

## 失败归属

- 共同开场不一致或出现短 Genesis 摘要：玩家投影边界失败。
- N1 场景跨席位：决策场景投影失败（本模块不重写该权威）。
- 按钮顺序错误：既有页面状态机回归。

## 测试与验收

- 聚焦 API 测试：已有异步 Genesis 文本时，六席仍返回同一完整共同开场；提交行仍经过绑定校验；`REPLAY` 与 `FAST` 共用同一投影规则。
- 聚焦浏览器测试：共同开场 -> 进入局势 -> N1 场景 -> 进入决策。
- API 类型检查。
- 真实 `/game` 浏览器回读当前测试房间；若环境中的旧房间仍存在，验证其无需重建即可看到共同开场。

## 回滚

单独回退本模块提交；数据库无需迁移或数据回滚。

## 验收记录（2026-08-15）

- API 聚焦测试：共同开场投影与六席一致性 `12/12 PASS`；N1 投影聚焦用例 `1/1 PASS`。
- Web 既有流程回归：`5/5 PASS`。
- Solo 开场展示回归：`2/2 PASS`；本模块未修改 Solo 文件。
- API TypeScript 类型检查：`PASS`。
- 真实 `PRESSURE_GAME_READ_MODE=FAST` 房间：共同开场完整文本 593 字，批准的首尾文本均存在，短 Genesis 文本不存在；随后依次出现“进入局势”、当前浙江总督 N1 场景、“进入决策”和 4 个决策输入。
- 玩家可见前端文件修改：无；数据库、路由与公共 API 合同修改：无。
