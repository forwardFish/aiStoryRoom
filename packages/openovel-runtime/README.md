# Openovel runtime architecture shadow lane

This package implements the first four explicitly approved stages of the
evidence/runtime architecture experiment:

1. compile and validate an immutable, line-addressed source evidence package;
2. maintain a source-hash-bound human review queue for every Scene, Claim, and Continuity item;
3. compile evidence plus explicit T0/T2/T3 rules into a World Bible and reverse Source Map;
4. compile a player-specific foreground working set from that World Bible in shadow mode;
5. compare the current Solo context with the shadow context for the same input;
6. run one real DeepSeek turn without publishing to a room, database, API, or player.

## Hard boundary

`apps/api` and `apps/web` do not import this package. The commands only read the
checked-in source text and fixtures, then write local audit artifacts under
`outputs/openovel-runtime/` (ignored by Git). A successful shadow turn sets
`soloTakeoverEligible` to `false` and `stageStatus` to
`AWAITING_USER_STORY_CONFIRMATION`.

Player-facing decisions contain one plain-language `text` field only. Internal
target, axis, and grounding IDs remain available for validation, but labels,
action summaries, and risk explanations are rejected so the UI does not tell
the player how to judge a choice. Decision text is an action summary with the
shape `concrete action + concrete object/goal + follow-up handling`; character
dialogue, inner voice, vague references, and dialogue punctuation are rejected.

Writer contract v5 deliberately omits `affordanceId`, `actorRef`, `targetRefs`,
`decisionClass`, fixed scene references, and grounding from the model output.
The Writer returns narrative prose, a visible ending-state summary, compact
`{ eventType }` event drafts, and three `{ text }` decisions. Server code binds
all actors, targets, tactics, state paths, affordance IDs, and grounding without
changing a single player-facing character.

For the land-register acceptance turn, a local Causal Turn Engine runs before
prompt compilation. It applies deterministic arc effects, detects material
change and stagnation, creates an NPC Reaction Envelope, limits the Writer to an
Allowed Event Envelope, and builds legal Decision Affordances. Event drafts are
proposals only: the validator checks that every event is allowed and visibly
occurred in the narrative before it can appear in the normalized shadow output.
No state is committed because this package remains an isolated audit lane.

Runtime facts and Context Cards live in `world-bible-authoring.json`, not in the
room fixture. The deterministic compiler verifies every source Claim and emits
`generated/world-bible/world-bible.json` plus `source-map.json`. A missing or
incomplete human review queue keeps `reviewGate` at `MISSING` or `PENDING` and
therefore remains Shadow-only.

Do not connect this package to Solo or multiplayer until the repository owner
has reviewed the real story output and explicitly approved the next stage.

## Commands

```powershell
pnpm openovel:evidence
pnpm openovel:evidence:validate
pnpm openovel:evidence:review:init
pnpm openovel:evidence:review:status
pnpm openovel:world-bible
pnpm openovel:compare
node --env-file="D:\lyh\agent\agent-frame\aiStoryRoom\.env.test" --import tsx packages/openovel-runtime/src/cli/run-shadow-turn.ts
```

The last command uses only DeepSeek credentials from the environment. It does
not read or write `DATABASE_URL`.
