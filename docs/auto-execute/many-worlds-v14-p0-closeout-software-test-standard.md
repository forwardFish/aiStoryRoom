# Many Worlds v1.4 P0 Closeout Software Test Standard

本标准禁止用接口成功替代页面操作，也禁止用旧报告替代本轮多浏览器和数据库证据。

## 1. Required layers

| Layer | Required proof |
|---|---|
| Unit | allowlist, state mapping, URL construction, reward cap, poster privacy |
| Integration | checkout/status/Webhook/unlock and bind/join/qualify/reward |
| UI | every button, return path, loading/error/retry and direct route |
| Visual | reference/actual/diff/metrics for each P0 UI state |
| Multi-user | isolated A/B/C seven rounds plus D/E/F invite permutations |
| API/DB | independent readback of purchase, ledger, unlock, share, referral, room, action and resolution |
| Deployment | local and built-output direct route smoke |

## 2. Non-substitution rules

- API calls cannot substitute visible user clicks.
- UI text cannot substitute database readback.
- Old PASS files cannot substitute a current RunId.
- One browser with three tokens cannot substitute isolated contexts.
- A mocked paid query cannot substitute a signed test Webhook.
- Screenshot presence cannot substitute a visual diff verdict.

## 3. Test identities

A is Host/payer; B and C are the other core players. D is first qualified invitee; E is second; F validates the cap. Every identity has a separate email, user id and browser storage. Test/sandbox provider data must be visibly labeled.

## 4. Expected counts

```text
core players=3
rounds=7
accepted actions=21
unique resolutions=7
purchase grants=1
unlock spends=1
reward ledgers=2
reward total=50
duplicate/self/capped rewards=0
runtime errors=0
privacy violations=0
```

## 5. Verdicts

Use only `PASS`, `PASS_WITH_LIMITATION`, `REPAIR_REQUIRED`, `BLOCKED_BY_MISSING_SOURCE`, or `FAIL`. A pure `PASS` requires every final-gate item and current durable evidence.
