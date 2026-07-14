# Many Worlds v1.4 P0 Closeout Requirement Traceability Matrix

每条 P0 需求都必须同时映射到实现任务和证据任务，任何一侧缺失都不算闭环。

| Requirement ID | Requirement | Tasks | Acceptance evidence |
|---|---|---|---|
| REQ-PAY-001 | Round-4 shortage opens PAY-01 with server values | T02,T03,T07,T10 | browser + API trace |
| REQ-PAY-002 | Wallet and confirm preserve safe return context | T02,T03,T07 | UI + contract tests |
| REQ-PAY-003 | Processing/paid/cancelled/failed share one template | T03,T08,T09 | visual artifacts |
| REQ-PAY-004 | Paid grants once, unlocks once and returns to same round | T02,T07,T10,T11 | Webhook + DB + browser |
| REQ-PAY-005 | Cancel/fail/delay are recoverable | T03,T07,T10 | branch traces |
| REQ-INV-001 | Room modal shows rewards and six channels plus copy | T05,T08,T10 | UI trace/diff |
| REQ-INV-002 | Combined room+ref link survives auth and auto-joins | T04,T05,T07,T10 | D browser trace |
| REQ-INV-003 | Share grants zero; D/E qualify; duplicates/self/F grant zero | T04,T07,T10,T11 | referral/ledger readback |
| REQ-POSTER-001 | Dynamic PNG and decodable real QR | T05,T07,T10 | download + QR report |
| REQ-ROUTE-001 | Canonical routes and no homepage dead links | T06,T07,T10 | route/link crawl |
| REQ-RESULT-001 | Result Share Recap has no fake destination | T03,T06,T10 | browser trace |
| REQ-VIS-001 | UI references replicated one-to-one | T01,T08,T09 | actual/diff/metrics |
| REQ-E2E-001 | A/B/C complete 7 rounds and 21 actions | T10,T11 | browser/API/DB evidence |
| REQ-SAFE-001 | No real charge, prod write, open redirect or secret leak | T02,T04,T07,T12 | security guard report |

Coverage is incomplete if any requirement lacks both an implementation task and an evidence-producing task.
