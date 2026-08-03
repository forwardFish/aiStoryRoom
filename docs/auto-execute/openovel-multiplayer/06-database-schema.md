# Database Strategy

Phase one is zero-schema-change unless implementation proves recovery cannot be expressed using existing fields:

- `ActorThread.lastAppliedSequence`
- `ActorTurn.contextJson/baseWorldSequence`
- `NarrativeEntry.worldSequence`
- `StoryContextSnapshotV2`
- `PromptExecutionRecord`
- `StoryTaskOutbox`

Workspace keys are deterministic: `rooms/<runId>/roles/<roleId>`.

If and only if required, add a `RoleNarrativeRuntimeBinding` migration file and validate it on a declared local/test database. Do not apply any migration to production.
