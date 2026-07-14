# Many Worlds v1.4 P0 Closeout Split Execution Prompts

| Stage | Tasks | Prompt |
|---|---|---|
| Baseline | T00—T01 | Create RunId; freeze source, route, asset and current-code gaps. Do not edit product before T01 evidence. |
| Payment | T02—T03 | Implement server-owned checkout context, PAY-01—07 and idempotent return-to-room; test/sandbox only. |
| Invite | T04—T05 | Implement combined room+ref auth/join, zero-share reward, qualified cap and dynamic poster QR. |
| Navigation | T06 | Canonicalize homepage/Header/Footer/routes and production rewrites; remove fake links. |
| Automated tests | T07 | Run unit/integration/direct-route/link/fault suites; repair failures before visual work. |
| Visual | T08—T09 | Compare every UI to its reference and loop repairs; PAY-03 source is confirmed at 1486×1058. |
| Real users | T10 | Drive A/B/C/D/E/F in isolated contexts; complete payment/invite/seven-round flows visibly. |
| Readback | T11—T12 | Reconcile API/DB counts and scan for real-payment/secret/privacy/runtime failures. |
| Final | T13 | Aggregate current RunId only against every final gate. |

Each stage must consume the previous handoff and produce its own result JSON and handoff only during actual execution.
