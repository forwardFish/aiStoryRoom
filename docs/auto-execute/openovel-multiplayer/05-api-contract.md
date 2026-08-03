# API Contract

## Internal runtime

- `POST /internal/openovel/rooms/:roomId/roles/:roleId`
- `POST /internal/openovel/rooms/:roomId/roles/:roleId/turns`
- `POST /internal/openovel/rooms/:roomId/roles/:roleId/impacts`
- `GET /internal/openovel/rooms/:roomId/roles/:roleId`
- `GET /internal/openovel/rooms/:roomId/roles/:roleId/jobs`

All require `OPENOVEL_INTERNAL_TOKEN`; player sessions never call them directly.

`RoleNarrativeInputV1` binds room, role, actor turn, turn index, base/applied world sequence, context hash, filtered working set, visible events/interactions, previous canon hash, and idempotency key.

`RoleNarrativeOutputV1` returns narration, 0-4 options, canon hash, workspace revision, applied world sequence, nonblocking warnings, and itemized usage. It contains no shared-state patch or hidden context.

## Error behavior

- 401/403: missing internal token or role ownership failure.
- 409: stale sequence, conflicting idempotency, or lost role lease.
- 429: model-call budget exceeded.
- 503: retryable provider/runtime outage with no fabricated story.
- Options may be empty; free input remains enabled.
