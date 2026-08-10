# Generic Endgame v3 S1—S4 exact-SHA verification trigger

This file records the linear stage chain that the repository workflow must verify from a fresh clone. It does not claim that the verification has passed; the authoritative execution evidence is the GitHub Actions artifact produced for the commit containing this file.

- S0 accepted base: `c9d268e0c49a9f8c196820853f82d2262df3b28d`
- S1 package loading and freezing: `ea90f682f7d94158f2755434ba753831f7586075`
- S2 metric trajectories: `3f52323f812b975af5b0b18bf642b227d26ce716`
- S3 multi-axis adjudication: `b0119cd653844e492fccbfd2c57245bdf5b31a91`
- S4 deterministic detail compilation: `00ca96fffe40a87ce96f893ef05a589e3d02c5a6`
- Exact-SHA workflow definition entered the branch at: `5d286489d5a53dc7c6972c5a847db51fefc558b8`
- Shared strict gate entered the branch at: `b6cb287ac77a1f49b4588441b0c2c8c102ef2f91`

This update intentionally triggers the repository's recognized exact-remote workflow against a commit that already contains the strict Generic Endgame S0—S4 gate. It is transport metadata only and does not alter S1—S4 product behavior.

The exact-SHA workflow must prove all of the following before this batch can be reported ready for independent Codex review:

1. clean clone HEAD, tracking ref, and `git ls-remote` SHA are identical;
2. frozen dependency installation succeeds;
3. S0, S1, S2, S3, and S4 strict test suites run with at least 201 total tests;
4. pass equals tests and fail, skipped, and todo are all zero;
5. `@ai-story/shared` typecheck and build succeed;
6. `git diff --check` succeeds and the post-build worktree is clean.
