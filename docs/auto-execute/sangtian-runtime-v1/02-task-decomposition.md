# 并行任务拆分

| ID | Lane | 所有者 | 目标路径 | 依赖 | 并行 | 验收 | 状态 |
|---|---|---|---|---|---|---|---|
| D2-R | Backend | ChatGPT Pro + Codex gate | `packages/templates/**runtime**`, `apps/api/**continuous-strategy**`, shared contracts/tests | D1 | 是 | D2 聚焦合同、持久化、恢复、类型/构建 | 进行中 |
| D3-MAP | Architecture | `parallel_d3_map` | 只读 | v1.1.0 | 是 | 文件/符号/测试落点 | 进行中 |
| D4-MAP | Frontend | `parallel_d4_map` | 只读 | v1.1.0 | 是 | `/game` 精确落点 | 进行中 |
| TEST-MAP | Test | `parallel_test_map` | 只读 | v1.1.0 CSV | 是 | 可执行测试所有权 | 进行中 |
| ARCH | Architecture | `parallel_architecture` | 只读 | D2 缺陷 + v1.1.0 | 是 | 冲突与集成边界 | 进行中 |
| D3-IMPL | Backend/AI | `d3_builder` | `apps/openovel-runtime/src/sangtian-pressure-*.ts` 与对应新测试；不得触碰 D2 kernel/root package | 冻结 v1.1.0 合同 | 是 | NAR-006、知识/Finale/失败降级 | 进行中 |
| D4-IMPL | Frontend | `d4_builder` | `apps/web/public/sangtian-pressure-game.js`、现有 `/game` 最小接线、对应新测试；不改 API 语义 | 冻结 projection 合同 | 是 | UX-001、UI-001、浏览器睡眠链 | 进行中 |
| TEST-IMPL | Test | 待映射后分配 | 专项 fixtures/E2E，不改产品文件 | TEST-MAP | 是 | LIVE-001、恢复、1+5 AI | 待开始 |
| INTEGRATE | Orchestrator | `/root` | 唯一批准分支 | D2/D3/D4 | 否 | 线性提交、精确 SHA、全量门 | 待开始 |

并行产物先作为互不重叠的工作树 diff；统一集成顺序固定为 D2 → D3 → D4 → 测试/证据 → 必要 D5。
