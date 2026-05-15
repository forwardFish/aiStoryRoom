# Stepwise Test Plan and Execution Record - 2026-05-13

## 1. 测试目标

针对 `docs/AI多人故事局_PRD_阶段化工程完整增强版_v5.md` 与 `docs/UI/2`，建立可重复执行的 P0-A 测试计划：

1. 每个 PRD P0-A 功能都有自动或人工验收步骤。
2. 多角色参与不是 mock 文案，而是 3 个独立 mock openid 完成 join、claim role、action、resolve。
3. Web 验证舱作为一等验收面，必须启动并跑核心交互。
4. DB E2E 如果 Docker 不可用，只能记 blocker，不能伪造通过。

## 2. 本轮执行命令与结果

| Gate | Command | Result | Evidence |
|---|---|---:|---|
| Typecheck | `pnpm typecheck` | PASS | terminal output |
| API test | `pnpm --filter @apps/api test` | PASS | terminal output |
| Mini program build | `pnpm --filter @apps/miniprogram build:weapp` | PASS | `apps/miniprogram/dist` |
| Web 验证舱 smoke | `powershell -File scripts/acceptance/run-web-cabin-smoke.ps1` | PASS | `docs/auto-execute/logs/web-cabin-browser-summary.json` |
| Preview API full flow | `powershell -File scripts/acceptance/run-full-flow-smoke.ps1 -Mode full` | PASS | `scripts/test-reports/story-e2e-1778668719151.json` |
| DB E2E | `powershell -File scripts/acceptance/run-db-e2e.ps1 -Mode full` | DOCUMENTED_BLOCKER | `docs/auto-execute/summaries/db-e2e.md` |
| Placeholder scan | Python scan for literal `????` | PASS | no source placeholders found |

## 3. 多角色 E2E 测试步骤

自动脚本：`scripts/e2e/story-multirole.ts`

对每个模板执行：

1. `GET /health`。
2. `GET /world-templates` 并断言 3 个模板存在。
3. 3 个 mock 玩家分别登录。
4. 玩家 A 创建 invite 故事局。
5. 玩家 B、C join。
6. 拉取角色列表，断言至少 3 个角色。
7. 断言角色含命运线、命运问题、私密线索、角色限制。
8. 3 玩家分别认领角色。
9. 断言 `activeHumanCount = 3`。
10. 对第 1 节点触发 `rewrite_needed` ActionGuard。
11. 对第 1 节点触发 `blocked` ActionGuard。
12. 对 1-5 节点，每节点 3 玩家提交正常行动。
13. 每节点断言 3 条行动均 accepted / guardStatus ok。
14. 每节点执行 AI Director mock 结算。
15. 每节点断言行动结果、三个回响、跨角色影响、线索变化、关系变化、危险等级。
16. 第 5 节点后断言章节生成。
17. 断言多 POV、个人故事卡、下一章预告、分享 token。
18. 断言通知、反馈/举报、admin dashboard、AI task、audit log、event log、ActionGuard 证据存在。

最新结果：`scripts/test-reports/story-e2e-1778668719151.json`。

## 4. Web 验证舱测试步骤

自动脚本：`scripts/acceptance/run-web-cabin-smoke.ps1`

1. 检查 `apps/web/public/index.html` 存在。
2. 检查 `apps/web/public/app.js` 存在。
3. 检查 root `package.json` 有 `dev:web` 与 `dev:preview-api`。
4. 启动 `pnpm dev:preview-api`。
5. 启动 `pnpm dev:web`。
6. 访问 `http://localhost:3001/api`。
7. 访问 `http://localhost:5177`。
8. 记录 HTML 与 app.js。
9. Chrome CDP 自动打开页面。
10. 等待模板加载。
11. mock 登录。
12. 创建故事局。
13. 模拟 3 玩家加入并选角色。
14. 提交正常行动。
15. 触发 ActionGuard。
16. 一键跑完 5 节点。
17. 断言章节、多 POV、个人故事卡、下一章预告、debug/API 日志。
18. 保存截图与 summary。

最新结果：PASS。

证据：

- `docs/auto-execute/summaries/web-cabin-smoke.md`
- `docs/auto-execute/logs/web-cabin-browser-summary.json`
- `docs/auto-execute/screenshots/web-cabin-smoke.png`
- `docs/auto-execute/screenshots/web-cabin-index.html`

## 5. UI/2 分步测试矩阵

| UI/2 asset | 测试方式 | 当前结果 |
|---|---|---:|
| 00_landing_pitch.png | 小程序 login/home route + build | PASS |
| 01_wechat_auth_login.png | mock login API + Web smoke | PASS |
| 02_home_story_hub.png | home route + templates API | PASS |
| 03_mode_select.png | mode route + create payload | PASS |
| 04_world_template_select.png | templates route + 3 templates | PASS |
| 05_create_story_run_config.png | create-run route + POST /story-runs | PASS |
| 06_join_story_hall.png | lobby route + join API | PASS |
| 07_story_created_invite_lobby.png | inviteCode + lobby | PASS |
| 08_role_select.png | roles route + claim API | PASS |
| 09_role_card_detail.png | role-card route + fate/private fields | PASS |
| 10_story_room_node_overview.png | room route + currentNode | PASS |
| 11_action_submit_form.png | action route + submit API | PASS |
| 12_waiting_players_actions.png | action count via node actions | PASS |
| 13_ai_resolution_summary.png | resolution route + resolve API | PASS |
| 14_node_result_detail.png | resolution details | PASS |
| 15_chapter_complete_summary.png | chapter generated after 5 nodes | PASS |
| 16_chapter_reader.png | chapter route | PASS |
| 17_next_chapter_preview.png | chapter.nextHook | PASS |
| 18_share_story_card.png | share route/token | PASS |
| 19_my_story_runs.png | my-runs route/API | PASS |
| 20_unlock_next_chapter.png | P0 非目标，支付/商业化占位 | DEFERRED |
| 21_my_fate_line.png | insight kind=fate-line | PASS |
| 22_my_chapters.png | insight kind=chapters | PASS |
| 23_notification_center.png | `/notifications` | PASS |
| 24_report_feedback.png | `/feedback/report` + audit | PASS |
| 25_ai_generating_status.png | AI task/admin state | PASS |
| 26_actionguard_rewrite.png | `/admin/action-guard` | PASS |
| 27_private_clue_detail.png | insight private clues | PASS |
| 28_fate_net_lite.png | insight relation/clue/node view | PASS |
| 29_three_echoes_summary.png | resolution.echoesJson | PASS |
| 30_cross_role_influence_detail.png | resolution.crossImpactsJson | PASS |
| 31_action_information_strategy.png | insight strategy panel | PASS |
| 32_ai_error_or_fallback.png | mock fallback state surface | PASS_WITH_LIMITATION |
| 33_chapter_reader_multi_pov.png | chapter.povSectionsJson | PASS |
| 34_chapter_catalog_timeline.png | nodes/timeline | PASS |
| 35_personal_story_card_detail.png | chapter.personalCardsJson | PASS |
| 36_personal_role_poster_share.png | share token/poster entry | PASS_WITH_LIMITATION |
| 37_world_status_overview.png | danger/world state | PASS |
| 38_character_relationship_overview.png | relations | PASS |
| 39_plot_timeline.png | nodes 1-5 | PASS |
| 40_suspicious_information_panel.png | clues/risk panel | PASS |
| admin_01_dashboard.png | `/admin/dashboard` | PASS |
| admin_02_story_runs.png | `/admin/story-runs`, `/admin/roles` | PASS |
| admin_03_ai_logs.png | `/admin/ai-tasks`, `/admin/event-logs` | PASS |
| admin_04_content_audit.png | `/admin/audit-logs`, `/admin/action-guard` | PASS |

说明：这里的 PASS 是“路由/API/构建/验收舱功能 PASS”，不是像素级截图 diff PASS。像素级一致性仍需新增 visual regression。

## 6. 下一步建议的测试增强

1. 新增 `scripts/acceptance/run-ui2-route-smoke.ps1`：逐个枚举 UI/2 asset 对应 route/kind，保存 HTML/截图/接口摘要。
2. 新增 `scripts/acceptance/run-ui2-visual-diff.ps1`：对 UI/2 参考图与实际页面截图做阈值 diff。
3. 将 `scripts/e2e/story-multirole.ts` 扩展为两个模式：preview mode 与 real-api mode；real-api mode 在 Docker 恢复后作为硬门禁。
4. 把 `MODULE_TYPELESS_PACKAGE_JSON` warning 单独收敛，避免测试输出噪声。
