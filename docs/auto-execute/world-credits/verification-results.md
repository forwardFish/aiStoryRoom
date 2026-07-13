# World Credits Verification Results

## Local implementation gate

- `pnpm db:generate`: PASS
- `pnpm prisma validate`: PASS.
- `pnpm prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url postgresql://ai_story@127.0.0.1:55434/ai_story_shadow_wc?schema=public`: PASS, no difference detected.
- `pnpm prisma db push --accept-data-loss --skip-generate`: PASS against the existing local PostgreSQL schema; no reset was performed.
- `pnpm --filter @apps/api typecheck`: PASS
- `pnpm --filter @apps/web typecheck`: PASS
- `pnpm --filter @apps/api test`: PASS
- `pnpm --filter @apps/web test`: PASS, 14/14 including World Credits page tests.
- `pnpm exec tsx scripts/e2e/world-credits-local.ts`: PASS
- HTTP page smoke: `GET http://127.0.0.1:5200/credits.html` -> 200.
- Creem Test product link reachability: both documented 300 and 650 payment URLs returned HTTP 200; no payment was initiated by this probe.

## Real Creem Test payment gate

- Real 300 Credits dynamic Checkout: PASS; Creem status `completed`, local `CreemPurchase=PAID`, `checkout.completed=PROCESSED`, order/transaction IDs and `+300 PURCHASE` ledger are recorded in `results/real-checkout-300-result.json`.
- Public HTTPS Web/API proxy: PASS; public Web page and API health returned 200, and a signed public Webhook probe was processed.
- Real 650 Credits dynamic Checkout: PASS; Creem status `completed`, local `CreemPurchase=PAID`, `checkout.completed=PROCESSED`, order/transaction IDs and `+650 PURCHASE` ledger are recorded in `results/real-checkout-650-result.json`.
- Real two-pack wallet readback: PASS; purchased balance is `950`, bonus `0`, debt `0`.

## Business-flow evidence

Evidence file: `docs/auto-execute/world-credits/results/local-flow.json`

- verified signup bonus: +50 exactly once;
- two qualified referrals: inviter bonus 100;
- third qualified referral: `QUALIFIED_NO_REWARD` with `MVP_REWARD_LIMIT_REACHED`;
- 300 package: purchased +300, available 400 before second purchase;
- 650 package: purchased +650, available 1050;
- duplicate checkout webhooks: `duplicate=true`, no second ledger;
- invalid webhook signature: HTTP 401;
- World unlock: one row, second call `alreadyUnlocked=true`;
- partial refund: 151 credits removed;
- dispute: 650 credits removed;
- final local-flow balance: purchased 149, bonus 0, debt 0.

## Not yet proven

The run used `CREEM_MOCK_MODE=true`, so it proves local API/DB/webhook behavior only. It does not prove a real Creem Dashboard transaction. Real completion requires Test API Key, Test Webhook Secret, Dashboard webhook endpoint and a public HTTPS tunnel.
