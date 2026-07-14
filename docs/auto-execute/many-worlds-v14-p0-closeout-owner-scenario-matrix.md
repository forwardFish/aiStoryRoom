# Many Worlds v1.4 P0 Closeout Owner Scenario Matrix

本矩阵从真实用户视角覆盖匿名访客、房主、两名核心玩家和三名新受邀用户的完整操作。

| Scenario ID | Actors | Visible actions | Required outcome |
|---|---|---|---|
| OS-HOME-01 | anonymous | click every header/hero/footer item | no dead/fake link; correct canonical target |
| OS-AUTH-01 | D | open invite, register, verify, login | resumes `/join`, auto-enters room |
| OS-INV-01 | A,D | share channel/copy/poster; D completes opening | share reward 0; qualify reward 25 |
| OS-INV-02 | A,D,E,F | repeat, self, second and capped invite | totals are +0,+0,+25,+0 after first D |
| OS-POSTER-01 | A,D | download, decode QR, open in fresh browser | same combined room+ref URL |
| OS-PAY-01 | A | round-4 gate, wallet, confirm, test pay | one purchase grant and one unlock |
| OS-PAY-02 | A | return unpaid | cancelled state, balance unchanged, return/retry works |
| OS-PAY-03 | A | success before Webhook | processing waits, no duplicate purchase prompt |
| OS-PAY-04 | A | provider/create failure | failed state, retry starts a new safe attempt |
| OS-MP-01 | A,B,C | separate contexts, 7 rounds | 21 accepted actions, 7 resolutions |
| OS-RESULT-01 | A,B,C | open result and all actions | dynamic result; no empty Share Recap destination |
| OS-SEC-01 | attacker user | checkout/room IDOR and external returnTo | denied, no data leak/open redirect |

Each scenario requires browser trace, screenshots at checkpoints, console/network capture and an independent API/DB assertion where data changes.
