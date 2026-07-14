# Many Worlds v1.4 P0 Closeout Development Standard

本标准要求复用现有页面，补齐支付与邀请闭环，并保持服务端状态、页面跳转和资产引用一致。

## 1. Product rules

1. Reuse existing pages: payment states share one template; confirm is a wallet state; invite is a room modal; `/join` is a headless transition; Share Recap is display-only.
2. All product links use canonical extensionless routes from the route document.
3. Server owns purchase state, return context, room membership and reward eligibility.
4. Creem signed Webhook is the purchase entitlement truth; query parameters never mark an order paid.
5. Share-event creation always grants zero. Only a qualified, first-time invitee opening can grant 25 Bonus Credits, at most twice.
6. Poster QR encodes the real combined room+ref URL and excludes private role, wallet, player list and payment data.

## 2. UI implementation

- Reference-first: record hash and dimensions before coding.
- Reuse `pic/`, the 46-icon pack and stable asset keys.
- Key geometry tolerance is 2 CSS px; no screenshot overlays.
- Responsive behavior must not hide the primary action, return control or reward condition.
- Loading, empty, error, cancelled, failed, paid and retry states are explicit.

## 3. API and security

- Validate `returnTo` against internal route prefixes and reject absolute/protocol-relative URLs.
- Validate the current user owns the purchase and belongs to the run/room.
- Preserve idempotency across checkout double-click, Webhook replay, paid-page refresh, unlock retry, referral qualify retry and room join retry.
- Never expose provider secret, Webhook secret, raw internal DB ids or other users' purchase/private action data.

## 4. Repository discipline

- Inspect `git status` before edits; do not overwrite unrelated changes.
- Apply the smallest repo-native patch.
- No generated evidence, screenshots or result JSON during planning-only work.
- Build and tests must use repository scripts or add narrow scripts that are documented in the package manifest.
