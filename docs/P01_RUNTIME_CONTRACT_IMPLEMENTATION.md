# P01 Runtime Contract implementation

P01 adds a world-independent contract, fail-closed runtime validation, deterministic predicate application, and a hash-verified world registry under `packages/templates/src/runtime-contract`.

The existing game registry, story-package loader, continuous-strategy packages, and both OpenNovel workspaces remain unchanged. World-specific names and fixture values are isolated in `fixtures.ts` and tests. The core knows only stable IDs, entity/predicate kinds, references, visibility, revisions, and rules. Ordinary narrative texture is therefore not durable unless a story package explicitly registers it as a supported durable entity kind.

This phase deliberately does not implement action normalization, full settlement, narration, review/repair/fallback, API, persistence, or UI work.
