# Many Worlds v1.4 P0 Closeout API/DB Contract Matrix

本矩阵用于约束本轮支付、邀请、房间和七轮游戏的接口、权限、幂等与数据库读回。

| Contract ID | API/action | Auth/ownership | DB truth | Idempotency/readback |
|---|---|---|---|---|
| API-BILL-01 | `POST /api/v4/billing/checkouts` | current user; run membership for unlock | `CreemPurchase` + server return context | one active attempt per idempotency key |
| API-BILL-02 | `GET /api/v4/billing/checkouts/:checkoutId` | purchase owner only | provider/internal status | cannot trust query paid flag |
| API-WEBHOOK-01 | `POST /api/v4/webhooks/creem` | verified provider signature | purchase + credit grant ledger | event replay grants once |
| API-UNLOCK-01 | `POST /api/v4/story-runs/:runId/unlock` | room member | `WorldUnlock` + spend ledger | repeated call spends once |
| API-REF-01 | `GET /api/v4/referrals/me` | current user | referral code/count/rewards | independent count readback |
| API-REF-02 | `POST /api/v4/referrals/share-events` | current user | `ReferralShareEvent` | `creditsGranted=0` always |
| API-JOIN-01 | `POST /api/v4/rooms/join-by-code` | current user | room membership/player | repeated join returns same membership |
| API-ROOM-01 | `GET /api/v4/rooms/:roomId` | member/private visibility | room/player/role | no other purchase/private action |
| API-ACTION-01 | `POST /api/v4/rooms/:roomId/game/action` | member with role | node action | one accepted human action/role/round |
| API-RESOLVE-01 | `POST /api/v4/rooms/:roomId/game/resolve` | host | node resolution | one authoritative result/round |

## Required negative contracts

- IDOR on checkout, room or result returns 403/404 without existence leakage.
- `returnTo` rejects absolute, protocol-relative, encoded external and script URLs.
- Share/open/copy never changes wallet.
- Self invite, existing binding, duplicate invitee and cap-exceeded qualify never add a reward ledger.
- Paid page refresh and two simultaneous tabs do not add purchase or unlock ledgers.

## Independent readback set

Read purchase, credit wallet, credit ledger, world unlock, referral code, referral binding, share events, room players, seven round actions and seven resolutions by current RunId. Record stable IDs/counts and redact secrets/tokens.
