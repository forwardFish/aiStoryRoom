# T05 — Invite Reward Modal, Social Channels and Poster

## 0. 任务模板选择

| Field | Value |
|---|---|
| Task Template ID | `TPL-EXPORT-DOWNLOAD` |
| 为什么选这个模板 | 任务核心包含可下载海报、二维码和渠道导出 |
| 主验收面 | 邀请弹层、分享 URL、PNG、QR 与隐私 |
| 覆盖对象 | UI-INVITE-01、UI-POSTER-01、REQ-POSTER-001 |
| Requirement IDs | `REQ-INV-001`, `REQ-POSTER-001` |
| UI IDs | `UI-INVITE-01`, `UI-POSTER-01` |

## 1. 目标

Implement the room invite modal with reward explanation/progress, WhatsApp, Telegram, Discord, Facebook, X, Copy link, popup/clipboard fallbacks and a dynamically generated PNG poster with a real QR.

## 2. 验收标准

- Channels receive correctly encoded combinedInviteUrl.
- Share-event readback grants zero.
- Poster downloads as valid PNG; QR decodes to the same URL in a fresh session.
- Poster contains no host/player/private role/wallet/payment data.

## 执行命令

```powershell
pnpm --filter @ai-story-room/web test
pnpm test:many-worlds-pages
pnpm test:many-worlds-visual
```

## 依赖与续跑门槛

Requires T04 PASS and readable poster background/icon sources. If a brand icon is absent, use the generated/official asset defined by the asset document and record provenance.

## 防停止规则

Do not export the static reference poster as the user's poster. Do not ship a fake QR. Do not claim native Discord web sharing if the browser only supports copy/fallback.

## 失败修复路由

Wrong URL/reward data → T04. Canvas/font/CORS/QR/download problem → repair T05. Geometry/color mismatch → T09 after T08.

## 结果 JSON

Write `docs/auto-execute/results/T05.json` with channel checks, download metadata, decoded QR, privacy scan and verdict.

## HANDOFF

Write `docs/auto-execute/latest/T05-HANDOFF.md` with modal fixture, poster artifact path and known browser limitations.
