# T12 — Report, Secret, Real-Payment and Privacy Guard

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-REPORT-GUARD` |
| 为什么选这个模板 | 最终证据需要检查密钥、真实扣费、隐私和报告一致性 |
| 主验收面 | 安全扫描、支付环境、日志和证据完整性 |
| 覆盖对象 | 当前 RunId 的代码、日志、截图、下载和报告 |
| Requirement IDs | `REQ-SAFE-001` |
| Scope | current RunId code, logs, screenshots, downloads and reports |

## 1. 目标

Scan final artifacts and runtime for secrets, production/real-payment use, PII/private-role leakage, open redirects, console/network failures and report inconsistencies.

## 2. 验收标准

- Provider mode is test/sandbox/fixture and no real charge occurred.
- No production write, secret/token/cookie, unrelated email, raw Webhook secret or private role/action leak.
- Poster/download is privacy-safe.
- Every report references current RunId and existing paths.

## 执行命令

```powershell
git diff --check
rg -n "sk_live|CREEM_API_KEY=|WEBHOOK_SECRET=|Authorization: Bearer" docs/auto-execute apps --glob "!**/node_modules/**"
```

Use redaction-aware scans and manually inspect matches; examples/variable names are not automatically leaks.

## 依赖与续跑门槛

Requires T10 and T11 terminal artifacts. Resume only if the evidence tree is unchanged or rescan it.

## 防停止规则

Do not suppress matches without classification. Do not rewrite historical user evidence. A real-payment or privacy violation is a hard failure, not a limitation.

## 失败修复路由

Secret/log leak → remove/redact then rerun owning test. Poster privacy → T05. Open redirect → T06/T02/T04. Real payment/prod mutation → FAIL and stop for user review.

## 结果 JSON

Write `docs/auto-execute/results/T12.json` with scan scope, classified findings, provider/environment proof and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T12-HANDOFF.md` with sanitized final evidence inventory and T13 readiness.
