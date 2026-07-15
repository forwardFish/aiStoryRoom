# TOTAL-AUTH-20260715：生产认证闭环

本目录是与根目录旧版视觉/单人游戏验收隔离的功能闭环 run。不得覆盖 `docs/auto-execute/00-goal.md`、根目录 `state.json` 或旧版 `latest/HANDOFF.md`。

## 顺序与 Gate

| 阶段 | 范围 | 进入下一阶段的条件 |
|---|---|---|
| A0 | 测试基线与工作树保护 | typecheck、API、Web 测试通过；Prisma 引擎占用单独记录 |
| A1 | 邮箱身份与一次性 token | 单元/API/浏览器测试通过；无明文 token 回显 |
| A2 | 邮件 provider | file sink 通过；Resend 配置契约/readiness 通过 |
| A3 | Google 身份 | 验签、challenge、关联、回跳与前端契约通过 |
| A4 | 模块集成验收 | 全部本地 Gate、代码复查、证据清单；外部账号项精确列为 BLOCKED 或待执行 |

## 关联文件

- 任务拆解：`02-task-decomposition.md`
- API 契约：`05-api-contract.md`
- 数据模型：`06-database-schema.md`
- 验收清单：`07-acceptance-checklist.md`
- 测试矩阵：`08-test-matrix.md`
- 修复日志：`09-repair-log.md`
- 当前状态：`state.json`
- 可恢复断点：`latest/HANDOFF.md`
