# B0 C1 contract gate

This stable note records the exact CI commands used to validate the public B0 contract checkpoint on the candidate branch:

```text
pnpm --filter @ai-story/shared typecheck
pnpm --filter @ai-story/templates typecheck
pnpm --filter @ai-story/templates test:b0-contract
pnpm --filter @apps/api typecheck
pnpm --filter @apps/web typecheck
```

The existing `pnpm test:causal` regression remains after these focused gates and is reported independently; a historical failure in that later aggregate command is not reclassified as a B0 contract PASS.
