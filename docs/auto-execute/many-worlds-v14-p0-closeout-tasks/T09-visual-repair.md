# T09 — Bounded Visual Repair Loop

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-VISUAL-REPAIR` |
| 为什么选这个模板 | 需要依据量化差异进行有界修复循环 |
| 主验收面 | 修复前后指标和功能无回归 |
| 覆盖对象 | T08 全部 material deviation |
| Requirement IDs | `REQ-VIS-001` |
| Input | T08 ranked material deviations |

## 1. 目标

Repair the smallest high-impact UI mismatches and rerun T08 until every available reference passes or an honest source/environment blocker remains.

## 2. 验收标准

- Fix order: shell geometry → typography → spacing → colors/borders/shadows → assets → responsive states.
- No screenshot overlay, hardcoded test-only state or functional regression.
- Each loop records before/after metrics and stops only at pass or explicit blocker.

## 执行命令

```powershell
pnpm test:many-worlds-pages
pnpm test:many-worlds-visual
```

## 依赖与续跑门槛

Requires T08 `REPAIR_REQUIRED`. PAY-03 source is present; repair only measured implementation differences and never modify the reference to force a pass.

## 防停止规则

Do not declare “close enough” when a material threshold fails. Do not change the reference image. Do not break payment/referral semantics to match a static screenshot.

## 失败修复路由

Functional regression → owning T03/T05/T06 then T07. Persistent visual mismatch → continue bounded loops with one hypothesis per patch. Missing source → T00/user asset prerequisite.

## 结果 JSON

Write `docs/auto-execute/results/T09.json` with loop count, patches, before/after metrics, remaining deviations and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T09-HANDOFF.md` with final visual status and readiness for T10.
