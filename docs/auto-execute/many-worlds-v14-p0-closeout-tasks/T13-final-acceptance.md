# T13 — Final Evidence-Only Acceptance Gate

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-FINAL-GATE` |
| 为什么选这个模板 | 最终只能聚合证据，不能再用实现动作掩盖缺口 |
| 主验收面 | 所有需求、证据路径、计数和最终 verdict |
| 覆盖对象 | v1.4 全部 P0 Requirement ID 与 Final Gate |
| Requirement IDs | all v1.4 P0 requirement IDs |
| Truth source | final acceptance gate + current RunId artifacts |

## 1. 目标

Independently aggregate T01—T12 evidence, verify every final checkbox and return an honest terminal verdict without implementing new product changes.

## 2. 验收标准

- Every requirement has implementation and current evidence.
- UI, route, payment, invite, poster, A/B/C gameplay, D/E/F reward, DB reconciliation and security guards all pass.
- Artifact paths exist and counts agree across browser/API/DB.
- PAY-03 source is confirmed, but missing implementation/actual/diff evidence still prevents pure PASS.

## 执行命令

```powershell
Get-Content -Raw -Encoding UTF8 docs/auto-execute/many-worlds-v14-p0-closeout-final-acceptance-gate.md
Get-ChildItem docs/auto-execute/results -Filter "T*.json" | Sort-Object Name
git status --short
```

## 依赖与续跑门槛

Requires terminal T01—T12 results for the same RunId. Any missing/stale/mixed artifact returns to T00/T12 rather than being assumed.

## 防停止规则

Do not average failures into PASS. Do not use old evidence. Do not downgrade financial duplication, privacy, security, broken route or incomplete seven-round flow to a cosmetic limitation.

## 失败修复路由

Return `REPAIR_REQUIRED` with the earliest owning task and exact failed gate. Return `BLOCKED_BY_MISSING_SOURCE` only for a real absent source. Return `PASS_WITH_LIMITATION` only for non-P0, explicitly accepted limitations.

## 结果 JSON

Write `docs/auto-execute/results/T13.json` with RunId, requirement verdicts, evidence paths, counts, limitations/blockers and final verdict.

## HANDOFF

Write `docs/auto-execute/latest/T13-HANDOFF.md` with the final user-facing outcome, verified completed scope, remaining blocker/limitation and safe next action.
