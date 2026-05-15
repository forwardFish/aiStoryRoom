# Repair Plan

Generated: 05/13/2026 21:51:37

Agent must edit implementation, tests, or evidence for these gaps before the next convergence run.

## GAP-REQ-001

- Type: requirement
- Severity: IN_SCOPE_GAP
- Source: docs\auto-execute\requirement-candidates.json
- Problem: No normalized requirements are listed in requirement-target.json
- Repair target: Normalize docs/auto-execute/requirement-candidates.json into requirement-target.json with P0/P1/P2 acceptance criteria, surfaces, and evidence expectations.

## GAP-UI-001

- Type: ui
- Severity: IN_SCOPE_GAP
- Source: docs\auto-execute\ui-target.json
- Problem: UI references exist but ui-target.json has no screens.
- Repair target: Map UI references to routes/screens in ui-target.json.
