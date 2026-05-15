# PRD / UI / Code Gap Audit - 2026-05-13

## 1. 审计结论

当前仓库已经达到 **P0-A mock/preview 可验收闭环**：preview API、多角色故事主流程、Web 验证舱、3 个世界模板、ActionGuard、5 节点推进、多 POV 章节、个人故事卡、通知/反馈/审核/事件/AI 任务日志均有本轮自动化证据。

但它还不是“生产可上线完成态”。剩余差距集中在三处：

1. **真实 DB / Nest / Prisma E2E：DOCUMENTED_BLOCKER**，Docker daemon 当前不可用，无法完成本机真实 Postgres 闭环。
2. **UI/2 像素级一致性：MANUAL_REVIEW_REQUIRED**，现有证据覆盖路由、API、构建和 Web 验证舱截图，但尚未建立逐张 UI/2 图片的自动截图比对。
3. **P1/P2 平台化能力：DEFERRED**，PRD 最终版中的 StoryWorld、Canon/Branch、创作者生态、商业化、生产内容审核工作流不属于 P0-A，本轮不实现。

## 2. 本轮新增/修复点

| 区域 | 当前状态 | 证据 |
|---|---:|---|
| acceptance harness | PASS | `scripts/acceptance/*.ps1`，含 `run-web-cabin-smoke.ps1` |
| Web 验证舱 | PASS | `apps/web/public/index.html`, `apps/web/public/app.js`, `docs/auto-execute/screenshots/web-cabin-smoke.png` |
| preview API | PASS | `scripts/preview-api.ts`, `scripts/test-reports/story-e2e-1778668719151.json` |
| 3 世界模板 | PASS | `packages/templates/src/index.ts`；E2E 覆盖 3 模板 * 5 节点 |
| ActionGuard 合约 | PASS | E2E 覆盖 `ok / rewrite_needed / blocked`，字段含 `status/accepted/rejected/guardStatus/matchedRules/suggestedRewrite/reason` |
| 多角色参与 | PASS | E2E 每模板 3 玩家 join + claim role + 15 次行动 + 5 次结算 |
| Admin 基础查看 | PASS | preview API 与 Nest API 均补齐 story runs / roles / actions / resolutions / ai tasks / audit logs / event logs / ActionGuard surface |
| 小程序 UI 文案占位 | PASS | 扫描已无源码内 `????` 占位符，`pnpm typecheck` 与 `build:weapp` 通过 |

## 3. PRD P0-A 对齐矩阵

| PRD P0-A 要求 | 代码位置 | 测试/证据 | 状态 |
|---|---|---|---:|
| mock 微信登录 | `story.controller.ts`, `preview-api.ts`, Web 验证舱 | Web smoke + E2E login | PASS |
| 3 个完整世界模板 | `packages/templates/src/index.ts` | E2E report 3 templates | PASS |
| 创建故事局、single/invite | `createRun`, Web cabin | E2E + Web smoke | PASS |
| 3 人加入与角色选择 | `joinRun`, `claimRole` | activeHumanCount=3 | PASS |
| 命运线、私密线索、角色限制 | `enrichFateLine`, templates | E2E role assertions | PASS |
| 5 SceneNode 行动提交与推进 | `submitAction`, `resolveNode` | 每模板 5 nodes | PASS |
| ActionGuard 拦截越权/宣布结果/操控他人/跳过剧情 | `guardAction` | rewrite_needed + blocked cases | PASS |
| AI Director mock 结算 | `resolveNode`, shared builders | action results / echoes / impacts / clue/relation/danger | PASS |
| 多 POV 章节、个人故事卡、下一章预告、分享 token | `generateChapter`, chapter endpoints | E2E chapter assertions | PASS |
| 通知、反馈/举报、审核日志 | `notifications`, `reportFeedback`, audit logs | E2E + admin audit | PASS |
| 事件日志、AI 任务日志 | `logEvent`, `aiTasks` | E2E admin counts | PASS |
| Admin 基础查看 | `admin*` endpoints | E2E admin counts | PASS |
| UI/2 页面 route/API/visual smoke | miniprogram routes + Web smoke | build + UI inventory + web screenshot | PASS_WITH_LIMITATION |
| 真实 DB / Prisma | Prisma schema + scripts | Docker unavailable | DOCUMENTED_BLOCKER |

## 4. UI/2 对齐情况

UI/2 有 00-40 主流程/扩展页面与 4 张 admin 图。当前代码对齐方式如下：

- 00-19 主流程：由小程序页面、preview API E2E、Web 验证舱自动交互共同覆盖。
- 21-40 扩展页面：由 `pages/insight/index?kind=...` 单页多状态承载，已修复可读文案和 API shape。
- admin_01-admin_04：由 `pages/admin/index` 与 `/admin/*` endpoints 承载。
- 20_unlock_next_chapter：按 P0 非目标保留为商业化占位，不接真实支付。

限制：目前没有逐张 UI 图片像素比对；如果目标是“和 UI 图片完全一致”，下一步需要加 mini-program/浏览器截图采集和 image-diff 阈值。

## 5. 还未完成 / 不应声称完成

| 项目 | 状态 | 原因 | 下一步 |
|---|---:|---|---|
| 真实 DB/Nest/Prisma E2E | DOCUMENTED_BLOCKER | Docker daemon 不可用 | 启动 Docker Desktop 后跑 `run-db-e2e.ps1 -Mode full` |
| UI/2 像素级回归 | MANUAL_REVIEW_REQUIRED | 当前只有路由/API/构建/Web smoke 截图，不是逐图 diff | 增加截图脚本和 UI diff 阈值 |
| 生产数据库、生产支付、生产审核 | DEFERRED | 明确非 P0-A | P1/P2 再做 |
| Node MODULE_TYPELESS_PACKAGE_JSON warning | DEFERRED | 不影响 P0-A gate | 可给 `apps/api/package.json` 增 `type` 或调整测试入口 |
