# Decision Log

- 2026-05-13T21:55:43: UI/2 contains many mobile/admin reference screens but no automated pixel diff adapter. Conservative decision: map critical UI groups to implemented miniprogram/admin surfaces and consolidated Web validation cabin screenshot; mark visual status PASS_WITH_LIMITATION and pixelPerfectStatus MANUAL_REVIEW_REQUIRED, never UI_PIXEL_PERFECT_PASS.
- 2026-05-13T21:55:43: Real payment, production deployment, production DB, and real notification providers remain outside safety boundary. Local preview/mock evidence is acceptable only as PASS_WITH_LIMITATION where applicable.
- 2026-05-13T21:55:43: Restored historical docs from docs/backup to avoid delivering deletion of PRD/audit/setup/report history.
