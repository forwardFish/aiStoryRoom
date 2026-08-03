# Requirements Summary

## P0 architecture and authority

- `REQ-AUTH-001`: DB world core owns facts, resolution, resources, commitments, interactions, and world sequence.
- `REQ-AUTH-002`: Role runtime owns only POV canon, foreground, memory, cards, options, and projection cache.
- `REQ-AUTH-003`: shared world resolves before role canon renders; canon never writes shared truth back.
- `REQ-MODE-001`: add `continuous_openovel_v1` and `OPENOVEL_ROLE_V1` behind a test-room feature flag.
- `REQ-MODE-002`: preserve `OPENOVEL_V1`, `continuous_story_v2`, and `continuous_strategy_v1` contracts.

## P0 role runtime

- `REQ-ROLE-001`: deterministic room/role workspace path and role-level locking.
- `REQ-ROLE-002`: opening/result/impact/status APIs bind room, role, turn, idempotency, and world-sequence cursors.
- `REQ-ROLE-003`: stale projections cannot overwrite newer canon; restart and two-instance recovery are safe.
- `REQ-ROLE-004`: options/storykeeper failure cannot roll back committed canon or remove free input.

## P0 world and interaction

- `REQ-WORLD-001`: one monotonic sequence and unique ActionResolution under retry/concurrency.
- `REQ-WORLD-002`: A proceeds without waiting for B/C; other roles receive visible pending impacts without real-time narrator calls.
- `REQ-INTENT-001`: user input is intent, not another role's result.
- `REQ-INTENT-002`: request, refusal, conditional cooperation, institutional pressure, and forced attempts use InteractionRequestV2/contest rules.
- `REQ-PROTECT-001`: no unilateral permanent death, removal, total loss of action, AI replacement, or end-of-game confinement before finale.

## P0 knowledge and AI

- `REQ-KNOW-001`: PUBLIC/OBSERVABLE/LIMITED/PRIVATE/secret projection rules prevent leakage to context, prompt, canon, options, or API.
- `REQ-AI-001`: AI role acts only when triggered, only from legal candidates, with isolated context and epoch-bound results.
- `REQ-AI-002`: provider call hard caps are 3 ordinary, 4 with one AI response, 6 convergence, and 0 for unaffected roles.

## P0 UI and journey

- `REQ-UI-001`: existing multiplayer page exposes role canon, impacts, interactions, options, free input, generation, offline/AI status, and recovery.
- `REQ-UI-002`: no secret, prompt, state patch, internal payload, rationale, or unpublished action appears in UI/API.
- `REQ-E2E-001`: governor, xunfu, and magistrate complete 10-15 ordered world events across independent origins.

## P0 verification and delivery

- `REQ-VERIFY-001`: all commands and new unit/contract/concurrency/fault/three-role/browser suites execute from the tested SHA.
- `REQ-VERIFY-002`: M00-M12 evidence is current; any failed gate makes final verdict FAIL.
- `REQ-DELIVERY-001`: final remote feature-branch HEAD equals the independently tested SHA; no PR/merge/deploy.
