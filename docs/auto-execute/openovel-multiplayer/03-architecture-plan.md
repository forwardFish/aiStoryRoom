# Architecture Plan

```text
Web multiplayer role surface
  -> NestJS continuous_openovel orchestrator
     -> Continuous Story V2 World Core (authoritative DB truth)
     -> role knowledge projector
     -> interaction/protection/budget policies
     -> OpenNovel Role Runtime adapter
        -> rooms/<roomId>/roles/<roleId> isolated workspace
```

## Invariants

1. World core writes truth; role runtime renders projections only.
2. Each resolution has one world sequence and idempotency identity.
3. Role runtime outputs bind base/applied sequence and cannot commit stale canon.
4. Different role locks are independent; the same role serializes or deduplicates.
5. Existing structured V2 and Solo OpenNovel adapters remain selectable and unchanged by default.
6. Other-role impacts enqueue/project without immediate narration.
7. AI decisions pass the same resolver as human decisions.
8. No prompt-era Chinese phrase regex becomes a truth engine.

## Primary modules

- `packages/shared`: versioned JSON-serializable schemas and runtime validation.
- `apps/openovel-runtime`: role paths, role workspace, result/impact/storykeeper HTTP and recovery.
- `apps/api/src/continuous-openovel`: orchestrator, projection, budget, protection, config.
- `apps/api/src/continuous-story-v2`: runtime interface and adapter selection hooks.
- `apps/web`: feature-flagged role slice with existing multiplayer shell.
