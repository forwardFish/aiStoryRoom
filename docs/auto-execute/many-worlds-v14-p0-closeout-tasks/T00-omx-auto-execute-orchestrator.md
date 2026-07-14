# T00 — v1.4 P0 Closeout Orchestrator

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-ORCH-T00` |
| 为什么选这个模板 | 需要统一编排依赖、断点续跑和最终聚合 |
| 主验收面 | 任务状态、证据链和失败回修 |
| 覆盖对象 | T01—T13、RunId、最终门禁 |
| Execution mode | `same-session-serial` |
| Scope | T01—T13 dependency execution and evidence aggregation |

## 1. 目标

Create one RunId, snapshot the worktree, execute only dependency-ready tasks, preserve unrelated changes, and prevent a false final PASS. Read the delivery index, master plan and final gate before dispatch.

## 2. 验收标准

- One RunId names all new evidence.
- Each task result is validated before the next task consumes it.
- `REPAIR_REQUIRED` routes backward; missing PAY-03 blocks visual/final gate without stopping safe non-visual tasks.
- No real payment or production mutation occurs.

## 执行命令

```powershell
git status --short
Get-Content -Raw -Encoding UTF8 docs/auto-execute/many-worlds-v14-p0-closeout-auto-execute-master-plan.md
Get-Content -Raw -Encoding UTF8 docs/auto-execute/many-worlds-v14-p0-closeout-final-acceptance-gate.md
```

## 依赖与续跑门槛

No predecessor. On resume, read the most recent valid `docs/auto-execute/latest/Txx-HANDOFF.md` and confirm every referenced artifact exists. Ignore stale RunIds.

## 防停止规则

Do not stop at planning, compilation or one happy path. Continue until T13 is terminal or a precise external/missing-source blocker is recorded. Do not broaden scope to P1 pages.

## 失败修复路由

Route contract failures to T02/T04/T06, UI failures to T03/T05, visual failures to T09, E2E failures to the earliest owning task, and evidence/guard failures to T11/T12.

## 结果 JSON

Write `docs/auto-execute/results/T00.json` with RunId, task states, blockers, current gate and nextTask only during execution.

## HANDOFF

Write `docs/auto-execute/latest/T00-HANDOFF.md` with the verified next task, evidence root and preserved-worktree notes only during execution.
