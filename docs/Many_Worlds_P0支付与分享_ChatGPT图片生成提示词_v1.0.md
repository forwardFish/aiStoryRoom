# Many Worlds P0 支付与结果页分享展示：ChatGPT 图片生成提示词

> 版本：v1.2  
> 用途：将每个“图片生成提示词”直接交给 ChatGPT 生成 Web UI 参考图。  
> 本轮范围：只做 **支付闭环**，以及结果页上一个**展示级分享入口**。  
> 不做：邀请深链、邀请落地页、分享链接、公开分享页、分享 Token、公开范围选择、撤销分享、分享管理弹层、账户页、我的房间、订单页、历史结局。

## 1. 本轮需要生成的图

| 图片编号 | 页面或状态 | 优先级 | 页面复用 |
|---|---|---|---|
| PAY-01 | 游戏内解锁门槛 | P0 | 复用现有 `room-game.html`，只替换当前内容区 |
| PAY-02 | World Credits 钱包与充值 | P0 | 复用现有 `credits.html` |
| PAY-03 | 确认支付 / 订单展示 | P0 | 复用 `credits.html` 容器的 `step=confirm` 状态 |
| PAY-04 | 支付处理中 | P0 | 与 PAY-05/06/07 共用同一支付状态模板 |
| PAY-05 | 支付成功并回房间 | P0 | 与 PAY-04/06/07 共用同一支付状态模板 |
| PAY-06 | 支付取消 | P0 | 与 PAY-04/05/07 共用同一支付状态模板 |
| PAY-07 | 支付失败 | P0 | 与 PAY-04/05/06 共用同一支付状态模板 |
| SHARE-01 | 结果页：分享展示入口 | P0 | 复用现有 `/game/result`；仅展示，不新增分享流程 |

## 2. 所有图片共用的视觉规范

把下列要求附在每一张图片提示词中，确保它们像同一产品而不是多套页面。

```text
Create a polished desktop web application UI for "Many Worlds", an AI-powered shared story room platform.

Canvas: 1440 x 1024, desktop web UI, realistic product screenshot, crisp high-fidelity interface design.
Language: all visible UI copy must be English.
Style: calm premium collaborative product, not a fantasy game poster, not a crypto dashboard, not a mobile app.

Use this exact design system:
- page background #F8F9FD; white cards #FFFFFF; main text #11183F; secondary text #667085;
- primary purple #5B45F5; primary gradient #4938F5 to #854DF7;
- border #E5E7F2; success #20A66A; warning #E79A22; danger #E3515B; info #3B6DF6;
- font style Inter or modern system sans-serif;
- header height 72px; main max width about 1280px; 24px page gaps; cards have 16px radius and subtle shadows;
- only one visually dominant primary button per page; all other actions are outlined buttons or text links;
- shared header: Many Worlds logo at left, Explore Worlds / Rooms / World Credits in center, Help / English / avatar menu at right;
- use a compact muted Rome historical thumbnail or abstract story-world artwork only, never full-screen artwork;
- use realistic spacing, accessible contrast, and clear status patterns;
- do not show code, raw database IDs, test-account labels, email addresses, API tokens, debug data, private player actions, hidden objectives, or invite codes;
- avoid dense gradients, glassmorphism, excessive badges, neon, gaming HUDs, giant decorative headings, and more than one primary CTA.
```

## 3. 固定示例数据

```text
World: Caesar: The Last Spring of the Republic
Room: Night Council
Current role: Brutus
Current round: Round 4 of 7
Free opening: rounds 1–3 are free
Unlock price: 100 World Credits
Available balance before purchase: 40 World Credits
Credit packages: 300 Credits — $7.99; 650 Credits — $14.99
Order display code: MW-8F2A
Ending title: A Republic Without a Master
```

## 4. PAY-01：游戏内解锁门槛

**页面职责**：告诉用户为什么此刻不能继续、还差多少点，以及下一步去哪里充值。

**唯一主操作**：`Buy Credits`

### 图片生成提示词

```text
Generate PAY-01 using the shared Many Worlds design system above.

Show the "Night Council" main game screen at Round 4 of 7, dimmed by a light overlay. In the center, show a compact unlock paywall card, about 620px wide, with a small lock icon in a soft purple circle.

Card hierarchy:
Eyebrow: "Free opening complete"
Title: "Unlock the rest of this shared world"
Body: "Rounds 1–3 are free. One participant unlocks the room for everyone. There is no per-turn charge after unlock."
Two clear numeric columns: "Required 100 Credits" and "Your balance 40 Credits"
Small info row: "You need 60 more Credits to continue."
Primary purple gradient button: "Buy Credits"
Secondary text link below: "Back to room"

Behind the modal, retain only faint context: compact world header, room name "Night Council", and "Round 4 of 7". Do not show readable player decisions, sidebars, chat, or private story content. The design must make it obvious that the user can return to this exact room after purchase.
```

## 5. PAY-02：World Credits 钱包与充值

**页面职责**：用户知道还差多少点、选择哪个套餐、购买后会回到哪个房间。

**唯一主操作**：`Buy 300 Credits`

### 图片生成提示词

```text
Generate PAY-02 using the shared Many Worlds design system above.

Create a compact World Credits wallet page. Title: "World Credits". Subtitle: "Add credits, then return to Night Council." The page should feel focused and trustworthy, not like a financial dashboard.

At the top, show a slim blue return-context banner with a room icon:
"You are unlocking Night Council" and "You need 60 more Credits to continue Round 4."

Below, use a two-column layout.

Left: a white "Your balance" card with large "40" and label "World Credits available". Under it, two restrained rows: "Bonus Credits 40" and "Purchased Credits 0". One muted note: "Purchased Credits never expire."

Right: section title "Choose a pack" with exactly two package cards:
1. highlighted card with subtle purple border, small label "Best for this room", title "300 Credits", price "$7.99", primary button "Buy 300 Credits";
2. normal card, title "650 Credits", price "$14.99", outlined button "Choose 650 Credits".

At the bottom show a small trust row: "Secure checkout", "Credits added after confirmation", "Return to Night Council". Add a secondary text link "Back to room". Do not show account center, transaction history, local account creation, verification tokens, referral content, coupons, subscriptions, or more packages.
```

## 6. PAY-03：确认支付 / 订单展示

**页面职责**：在用户选择套餐后、跳转 Creem 托管 Checkout 前，明确本次支付买什么、支付后将回到哪里。

**唯一主操作**：`Continue to secure payment`

**页面复用**：不新建独立视觉页面；使用 `credits.html?step=confirm` 的同一钱包容器，但只显示本次订单确认内容。

### 完整点击与跳转路径

```text
Room Unlock Paywall
→ Buy Credits
→ /credits?returnTo=/room-game?runId=...&intent=unlock
→ 选择套餐
→ /credits?step=confirm&pack=credits_300&returnTo=...
→ Continue to secure payment
→ POST /v4/billing/checkouts
→ 跳转 Creem 托管 Checkout
→ /credits-success?checkout_id=...&returnTo=...
→ Payment Status
→ Return to Room
→ 原房间自动或一键解锁
```

### 图片生成提示词

```text
Generate PAY-03 using the shared Many Worlds design system above.

Create a Checkout Confirmation page for Many Worlds. This is an internal product page shown immediately before redirecting the user to a Creem hosted checkout. Reuse the World Credits page shell and the shared header, but focus only on one payment summary card; do not create a payment-method form.

Top page title: "Confirm your purchase"
Subtitle: "You will be redirected to our secure checkout."

Center a white order summary card about 720px wide. Include:
- a small purple Credits icon;
- title "300 World Credits";
- price "$7.99";
- a clearly separated line: "Your current balance 40 Credits";
- a clearly separated line: "Balance after payment 340 Credits";
- a blue return-context area with a room icon: "You are unlocking Night Council" and "Return to Night Council · Round 4 of 7";
- a short security note: "Credits are added only after payment confirmation."

Primary purple gradient button: "Continue to secure payment"
Secondary outlined button: "Back to World Credits"
Tiny text below: "You will complete payment on a secure Creem checkout page."

Do not show card-number inputs, payment-method fields, coupon codes, subscription choices, order history, receipt download, technical identifiers, raw URLs, or a fake embedded payment gateway. This page must make the external jump and the return-to-room context visually unmistakable.
```

## 7. PAY-04：支付处理中

**页面职责**：避免用户误以为未到账并重复付款。

**唯一主操作**：`Continue waiting`

### 图片生成提示词

```text
Generate PAY-04 using the shared Many Worlds design system above.

Create a generic Payment Status page in its pending state. Center a single elevated white status card, about 680px wide, in a calm spacious layout.

At the top of the card use a blue circular progress icon with a simple spinner.
Status label: "Payment processing"
Title: "Payment received. Adding your Credits."
Body: "This usually takes a few seconds. It is safe to keep this page open or refresh it."

Compact order summary: Package "300 World Credits", Order "MW-8F2A", Status badge "Processing", Return context "Night Council · Round 4 of 7".

Primary button: "Continue waiting"
Secondary outlined button: "Return to room"
Small footer note: "Credits are added only after payment confirmation."

Use blue information styling, not green success styling. Do not show a new balance, a fake success checkmark, payment-method logos, raw checkout IDs, or unrelated account content.
```

## 8. PAY-05：支付成功并回原房间

**页面职责**：确认到账，并引导用户回到付款前的房间继续解锁。

**唯一主操作**：`Return to Room`

### 图片生成提示词

```text
Generate PAY-05 using the shared Many Worlds design system above.

Create the same generic Payment Status page template as PAY-04, but in the paid state. Keep the exact same card size, structure, spacing, typography, and summary layout.

At top, show a green check icon in a pale green circle.
Status label: "Payment confirmed"
Title: "300 World Credits are ready."
Body: "Your balance has been updated. Return to Night Council to unlock the rest of the shared world."

Order summary: Package "300 World Credits", Order "MW-8F2A", Status badge "Paid", Updated balance "340 Credits", Return context "Night Council · Round 4 of 7".

Primary purple gradient button: "Return to Room"
Secondary text link: "View wallet"
Small safe-refresh note: "Returning will not charge you again."

The design should feel reassuring and fast. Do not add confetti, referral blocks, receipt download, refund controls, or account panels.
```

## 9. PAY-06：支付取消

**页面职责**：明确没有入账，也不让用户卡在支付页。

**唯一主操作**：`Try Again`

### 图片生成提示词

```text
Generate PAY-06 using the shared Many Worlds design system above.

Create the same reusable Payment Status page template as PAY-04 and PAY-05, in the cancelled state. Use an amber warning icon in a pale amber circle.

Status label: "Payment cancelled"
Title: "No Credits were added."
Body: "Your checkout was cancelled. You can try again whenever you are ready."

Compact summary: Package "300 World Credits", Order "MW-8F2A", Status badge "Cancelled", Return context "Night Council · Round 4 of 7".

Primary purple gradient button: "Try Again"
Secondary outlined button: "Return to Room"
Muted note: "Your balance has not changed."

Keep the design calm and non-alarming. Do not show a red destructive error state, a payment form, a refund flow, or an order-history table.
```

## 10. PAY-07：支付失败

**页面职责**：让用户知道支付没有完成，并给出安全重试和返回房间的出口。

**唯一主操作**：`Try Again`

### 图片生成提示词

```text
Generate PAY-07 using the shared Many Worlds design system above.

Create the same reusable Payment Status page template as PAY-04, PAY-05, and PAY-06, in the failed state. Use a restrained red error icon in a pale red circle.

Status label: "Payment could not be completed"
Title: "Your balance has not changed."
Body: "We could not confirm this payment. Try again, or return to your room and continue later."

Compact summary: Package "300 World Credits", Order "MW-8F2A", Status badge "Failed", Return context "Night Council · Round 4 of 7".

Primary purple gradient button: "Try Again"
Secondary outlined button: "Return to Room"
Small text link below: "Contact support"

Do not expose technical error codes, gateway details, raw transaction data, or a stack trace. The visual should be serious but not frightening.
```

## 11. SHARE-01：结果页上的分享展示入口

**MVP 定义**：只在结果页显示一个 `Share Recap` 次级操作，用来表达产品具备分享方向；本轮不设计点击后的新页面、弹层、公开链接或任何分享管理流程。

**页面职责**：解释结局，并让用户看到“可以分享回顾”的轻量入口。

**唯一主操作**：`Play Again`

### 图片生成提示词

```text
Generate SHARE-01 using the shared Many Worlds design system above.

Create a polished completed Game Result page for "Caesar: The Last Spring of the Republic" and room "Night Council". This is a normal private result page, not a public sharing page and not a share modal.

Use a spacious centered page with:
- compact world identity row with a small Rome thumbnail, world name, room name, and a green "Session Complete" badge;
- main ending title: "A Republic Without a Master";
- one short ending summary about avoiding civil war through compromise;
- three equal white summary cards: "Your Role" with Brutus portrait, "Your Ending", and "World State";
- a white "Key Decisions" card with exactly three numbered concise decisions;
- optional small goals-completed row.

At the bottom use an action area with exactly one dominant purple gradient primary button: "Play Again". Place "Try Another Role" and "Back to Worlds" as secondary outlined buttons. Place one small tertiary text action with a share icon: "Share Recap". The Share Recap action should be visibly available but deliberately lower emphasis than Play Again.

Do not open a modal, do not show a share URL, QR code, social icons, visibility options, revoke action, invite link, public story page, private player actions, hidden objectives, emails, Credits, payment information, or raw technical data.
```

## 12. 可选内部对比图：支付状态模板

这张图不是用户页面，只用于检查 PAY-04 至 PAY-07 是否复用了同一个组件。

```text
Create an internal UI design review board for Many Worlds showing four equal Payment Status cards in a 2x2 grid: Processing (blue), Payment Confirmed (green), Payment Cancelled (amber), Payment Failed (red). Every card uses identical icon placement, typography, card size, order-summary layout, primary button placement, and secondary action placement. Label it "Payment Status Component States". Use the Many Worlds design system. This is an internal component comparison board, not a user-facing product dashboard.
```

## 13. 生成后检查清单

- 所有产品文案为英文，没有乱码、占位符、测试账户或技术字段。
- PAY-03 明确显示“选择套餐后 → 跳转 Creem 托管支付前”的订单确认；不伪造自建银行卡支付表单。
- 所有支付状态图使用同一支付状态模板；只变图标、状态色和文案。
- 每页只有一个最强主按钮。
- 支付页始终能看出将回到 `Night Council`，但不会展示复杂订单历史。
- 结果页仅有低权重的 `Share Recap` 展示入口；没有额外分享页面、弹层、链接或管理功能。
- 不生成邀请落地页、邀请深链、公开故事页、账户/订单/历史结局等 P1 图片。

