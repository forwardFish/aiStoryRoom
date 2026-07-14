# T08 — One-to-One Visual Comparison

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-VISUAL-COMPARE` |
| 为什么选这个模板 | 需要只读生成 reference/actual/diff/metrics 判定 |
| 主验收面 | 视觉几何、像素、字体、资产和运行时 |
| 覆盖对象 | UI-PAY-01—07、UI-INVITE-01、UI-POSTER-01 |
| Requirement IDs | `REQ-VIS-001` |
| UI IDs | `UI-PAY-01`—`07`, `UI-INVITE-01`, `UI-POSTER-01`, result regression |

## 1. 目标

Capture actual states at reference viewports, compare against source images and produce quantitative plus human-readable verdicts without editing product code.

## 2. 验收标准

- Every available reference has reference/actual/diff/metrics/geometry/console-network.
- Critical geometry deviation is at most 2 CSS px.
- Non-dynamic area SSIM is at least 0.985 and changed-pixel ratio at most 1.5% unless an approved mask explains it.
- PAY-03 is captured and compared at its native 1486×1058 viewport; source hash must match the UI map.

## 执行命令

```powershell
pnpm test:many-worlds-visual
```

Use the repo visual harness or extend it; do not manually eyeball only.

## 依赖与续跑门槛

Requires T07 PASS and a stable local runtime. Each state must be reachable deterministically. PAY-03 source is already confirmed; re-check its hash before capture.

## 防停止规则

Do not alter CSS/DOM in this task. Do not mask primary text, buttons, totals, reward rules or navigation. Dynamic masks must be narrow and documented.

## 失败修复路由

Material mismatch → T09 with ranked geometry/color/type/asset findings. Functional/runtime failure → owning T03/T05/T06 rather than visual repair.

## 结果 JSON

Write `docs/auto-execute/results/T08.json` with per-UI metrics, artifact paths, material deviations and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T08-HANDOFF.md` with a ranked repair list or exact missing-source blocker for T09/T00.
