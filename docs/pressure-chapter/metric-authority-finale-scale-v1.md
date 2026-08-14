# Pressure Metric Authority and Finale Scale Contract v1

## Authority boundary

- Genesis content owns metric definitions and initial values.
- The accepted chapter Settlement branch is the only authority allowed to apply `trackDelta`.
- Settlement must commit the world state before any Narrative/Provider call.
- A chapter metric receipt is auditable as `before + delta = after` and is bound to one settlement branch plus one application key. Replays must return the same receipt; they must not apply the delta again.
- DeepSeek, prompts, UI copy, NPC dialogue and free text are expression-only. They cannot create, override or score metric values.

## Unified extension contract

Metrics use one contract with `metricId`, `scope`, `visibility`, `valueType`, `initialValue`, `bounds`, `updateRuleRef` and `finaleRuleRefs`. The validator accepts any positive metric count and therefore does not freeze the runtime to the current five public tracks.

Visibility is enforced before a viewer-scoped story pack is built:

- `PUBLIC`: visible to every viewer.
- `SEAT_PRIVATE`: visible only to the explicitly authorized seats.
- `SYSTEM_ONLY`: never projected to a player or Provider input.

No new private or system metric is enabled by this change.

## Current Finale scale audit

The accepted content package initializes the five public tracks at approximately 45–50 and chapter Settlement applies absolute deltas to that state. The existing Finale rule catalog evaluates `>= 2` and `<= -2`, which is a delta-from-Genesis scale.

Before Finale evaluation, the scale audit replays the frozen N1–N7 snapshots against exactly one content-owned Settlement branch per chapter under both candidates:

1. absolute Genesis baseline;
2. zero delta-from-Genesis baseline.

Only an unambiguous delta-from-Genesis chain is compatible with the current rule catalog. An absolute chain fails with `PRESSURE_FINALE_SCALE_MISMATCH`; an ambiguous, incomplete or non-content-owned chain fails with `PRESSURE_FINALE_SCALE_UNPROVEN`.

The production frozen `WorldState` chain is absolute. Therefore the current terminal path is intentionally fail-closed before evaluator or terminal commit. Completing Finale requires a separately approved public authority change: either configure absolute thresholds or add a hash-bound Genesis-to-delta derivation proof to the Finale contract and result evidence. This N1 multi-Beat task does not make that authority decision.
