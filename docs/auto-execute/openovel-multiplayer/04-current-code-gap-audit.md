# Current Code Gap Audit

Four independent read-only agents audited the frozen source at `d5aff309`.

## Confirmed reusable foundation

- Prisma already models one world sequence, ActorThread/Turn, ActionResolution, knowledge, interactions, commitments, prompt audit, role control and durable outbox.
- Continuous Story V2 already has serializable resolution reservation/publication, idempotency, role-scoped context compilation and nonblocking InteractionRequestV2.
- Solo OpenNovel already has durable canon-first writes, options/storykeeper separation, file leases, restart recovery, mirror outbox and HTTP token checks.
- The live Web chain already offers a story-first surface, options/free input, resolving state, interaction reply and limited impact history.

## P0 missing behavior

- No `continuous_openovel_v1`, `OPENOVEL_ROLE_V1`, strict Role Runtime contracts, adapter boundary, feature flag or room/role HTTP routes exist.
- Current result flow can wait on narrative before committing the world; the new engine must commit authoritative DB resolution first and render canon asynchronously.
- Solo runtime is keyed by `runId`, locked by run, hard-coded to Sangtian governor and treats its files as Solo truth; it cannot be reused as multiplayer authority.
- No room/role workspace, sequence/canon CAS, fencing-safe role commit or role job recovery exists.
- Existing player projection exposes other roles' goals/known info/leverage.
- Existing AI batching combines multiple private role working sets in one model prompt.
- `OBSERVABLE` is treated too broadly; it needs scene/audience filtering.
- Current AI-budget and concurrency commands exercise the old in-memory MVP, not Continuous OpenNovel.
- Mandatory async/browser scripts referenced by `package.json` are missing.
- No three-origin browser harness exists for this mode.

## Live Web integration seam

Extend the active chain:

`game-bootstrap.js -> continuous-story-v2-client.js -> continuous-story-v2-legacy-storage.js -> app.js`

Do not build the feature only in unused `continuous-story-v2-view.js`, `/trio`, or legacy `room-game.js`.

## Database decision

Zero-schema-change is feasible for the initial slice using existing JSON/outbox/snapshot fields, but completion depends on proving workspace revision, canon hash, sequence cursor, budget and replay durability. Add a binding migration only if implementation evidence shows those cannot be reconstructed safely.
