# Many Worlds v1.4 P0 Closeout Delivery Standard Index

## 1. Source of truth

| Priority | Source | Purpose |
|---:|---|---|
| 1 | `docs/Many_Worlds_MVP_v1.4_P0支付邀请分享完整流程开发步骤与验收步骤.md` | P0 functional scope and implementation order |
| 2 | `docs/Many_Worlds_MVP_v1.4_P0支付邀请分享功能测试与三玩家七轮真实用户测试.md` | test and evidence gates |
| 3 | `docs/Many_Worlds_MVP_v1.4_全站页面路由与多用户闭环流程.md` | canonical routes, links, redirects and multi-user flows |
| 4 | `docs/Many_Worlds_MVP_v1.4_UI素材目录与ChatGPT生成清单.md` | asset reuse and missing-source list |
| 5 | `docs/UI/web/MW-*.png` | pixel-reference truth |
| 6 | current API/schema/code | implementation baseline, not completion proof |

## 2. Delivery standards

| Standard | File |
|---|---|
| Orchestration | `many-worlds-v14-p0-closeout-auto-execute-master-plan.md` |
| Development | `many-worlds-v14-p0-closeout-development-standard.md` |
| Test | `many-worlds-v14-p0-closeout-software-test-standard.md` |
| RTM | `many-worlds-v14-p0-closeout-requirement-traceability-matrix.md` |
| UI map | `many-worlds-v14-p0-closeout-ui-reference-map.md` |
| API/DB | `many-worlds-v14-p0-closeout-api-db-contract-matrix.md` |
| External data | `many-worlds-v14-p0-closeout-external-data-validation-matrix.md` |
| Test plan | `many-worlds-v14-p0-closeout-standard-test-plan.md` |
| Owner scenarios | `many-worlds-v14-p0-closeout-owner-scenario-matrix.md` |
| Final gate | `many-worlds-v14-p0-closeout-final-acceptance-gate.md` |
| Execution prompts | `many-worlds-v14-p0-closeout-codex-exec-prompts.md` and `many-worlds-v14-p0-closeout-codex-exec-prompts-split.md` |
| Quality audit | `many-worlds-v14-p0-closeout-task-pack-quality-audit.md` |

## 3. Hard boundaries

- No real charge, production write, production customer or production secret.
- Preserve unrelated dirty-worktree changes.
- No order-history, account-center, refund-request or public-story page.
- Do not create fake page links to satisfy navigation checks.
- `MW-60_PAY-03_确认购买.png` is present as the confirmed 1486×1058 visual source; final pixel acceptance still requires implementation plus actual/diff/metrics.
- Existing evidence is historical only; final verdict reads current RunId evidence.
