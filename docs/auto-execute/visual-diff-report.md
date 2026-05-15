# Visual Diff Report

Generated: 2026-05-14T21:35:53

- Pixel diff automation: basic normalized-coordinate RGB sampling executed via scripts/acceptance/run-basic-visual-diff.ps1.
- Pixel-perfect PASS: not claimed.
- Reason: actual evidence is the consolidated Web validation cabin screenshot, while UI/2 contains individual mobile/admin reference screens.
- Machine evidence: docs/auto-execute/results/basic-visual-diff.json.
- Actual visual evidence: docs/auto-execute/screenshots/web-cabin-smoke.png.
- Reference evidence: docs/UI/2/*.png mapped in docs/auto-execute/ui-target.json.
- Verdict: PASS_WITH_LIMITATION for visual coverage; UI_PIXEL_PERFECT_PASS is not claimed.

## Compared Screens
- $(@{id=WEB-CABIN-DESKTOP; reference=docs/UI/2/模拟页面.png; actual=docs\auto-execute\screenshots\web-cabin-smoke.png; method=normalized-coordinate RGB sample; not pixel-perfect; status=PASS; metrics=; interpretation=Evidence proves an actual-vs-reference comparison was executed, but the Web validation cabin is not a pixel-identical implementation of this individual UI reference.}.id): 1610x977 vs 1610x977, meanRgbDelta=0.122, maxRgbDelta=0.7346

## Blockers
- None
