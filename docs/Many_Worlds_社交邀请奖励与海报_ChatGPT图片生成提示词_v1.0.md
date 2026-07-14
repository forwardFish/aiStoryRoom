# Many Worlds 社交邀请、奖励与邀请海报：ChatGPT 图片生成提示词

> 用途：直接复制每个“图片生成提示词”到 ChatGPT 图片生成工具，生成 Many Worlds 的邀请裂变 UI 与海报视觉稿。  
> 目标：替换当前房间页右上角只有“Copy Invite Link”的小模块，让用户能一眼看到：**邀请谁、分享到哪里、能获得什么奖励、如何使用邀请海报。**  
> 前台文案：英文；说明文档：中文。

## 1. 当前截图的问题与本轮设计方向

当前图中的邀请模块只有一个链接输入框和 `Copy Invite Link` 按钮，问题是：

- 邀请入口太小，像房间配置项，不像需要用户完成的传播动作。
- 没有告诉用户可分享到哪些社交平台。
- 没有奖励说明、奖励进度或“什么情况下才能获得奖励”的提示。
- 没有海报/二维码这一类适合聊天群、朋友圈和私信转发的视觉资产。

本轮改为：房间页保留一个轻量的 `Invite Friends` 次级按钮；点击后打开一个完整的 **Invite friends & earn rewards** 分享中心。分享中心内同时包含社交平台分享、复制链接、奖励说明、邀请进度和邀请海报预览。

## 2. MVP 交互闭环

```text
Host 在 Room Waiting 页面点击 Invite Friends
→ 打开 Invite friends & earn rewards 分享中心
→ 选择 WhatsApp / Telegram / Discord / Facebook / X / Copy link / Download poster
→ 发送带 roomCode 与 referral code 的邀请链接
→ 新朋友打开链接、注册并加入房间
→ 新朋友完成 opening
→ Host 获得 25 Bonus Credits
→ 分享中心的奖励进度从 0 / 2 更新为 1 / 2
```

奖励必须真实且克制地说明：

```text
Earn 25 Bonus Credits for each new friend who joins and completes the opening.
Up to 2 rewards.
Sharing alone does not grant Credits.
```

不要承诺“点击分享立即到账”，不要把邀请奖励与房间解锁扣点混在一起。

## 3. 本轮需要生成的图片

| 图片编号 | 用途 | 画布 | 触发入口 |
|---|---|---|---|
| INVITE-01 | Invite friends & earn rewards 分享中心 | 1440 × 1024，桌面 Web UI | Room Waiting 页的 `Invite Friends` |
| INVITE-02 | 社交分享完成状态 | 1440 × 1024，桌面 Web UI | 用户点击任一社交平台或 Copy link 后 |
| POSTER-01 | 可下载的竖版邀请海报 | 1080 × 1350，4:5 社交媒体海报 | 分享中心的 `Download poster` |

## 4. 所有图片共用的视觉规范

```text
Create a polished visual system for "Many Worlds", an AI-powered shared story room platform.

All visible product copy must be English. Use Inter or a modern system sans-serif.
Brand style: premium, friendly, collaborative, cinematic but restrained. Do not make it look like a casino, crypto product, military game HUD, or generic referral dashboard.

Web UI palette:
- page background #F8F9FD; card background #FFFFFF; main text #11183F; secondary text #667085;
- primary purple #5B45F5; primary gradient #4938F5 to #854DF7;
- border #E5E7F2; success #20A66A; warning #E79A22; info #3B6DF6;
- 16px card radius, subtle shadows, generous whitespace, 24px layout gaps.

Use the Many Worlds header for Web UI: logo at left; Explore Worlds, Rooms, World Credits in the center; Help, English, and avatar menu at right.

Use a warm, cinematic Rome-at-sunset image only as a contained thumbnail or poster art. Do not use a full-screen dark game background.
Avoid raw database IDs, test-account labels, email addresses, API tokens, technical fields, private role goals, private actions, chat logs, payment data, and full player lists.
```

## 5. 固定示例数据

```text
World: Caesar: The Last Spring of the Republic
Room: Night Council
Host: Alex Morgan
Room status: Waiting for players
Players: 3 / 6
Invitation reward: 25 Bonus Credits per qualified friend
Reward cap: 2 friends
Current reward progress: 0 / 2 qualified friends
Invite link display: manyworlds.com/join?room=night-council
```

## 6. INVITE-01：Invite friends & earn rewards 分享中心

**页面目的**：让 Host 直接完成“选渠道分享”这一个动作，同时理解奖励规则和海报用途。

**唯一主操作**：`Share invitation`

**页面形态**：从 Room Waiting 页面打开的居中大弹层或 Drawer；它不是小型输入框，也不应挤在房间 Header 右侧。

### 必须包含的信息

| 区块 | 内容 |
|---|---|
| 房间身份 | 世界缩略图、`Night Council`、`3 / 6 players`、`Waiting for players` |
| 奖励主卡 | `Invite friends. Earn up to 50 Bonus Credits.`、`25 Credits per qualified friend`、`0 of 2 rewards unlocked` |
| 规则说明 | `Friends must join and complete the opening. Sharing alone does not grant Credits.` |
| 社交分享 | WhatsApp、Telegram、Discord、Facebook、X、Copy link 六个渠道 |
| 海报 | 小尺寸竖版海报预览、`Download poster` |
| 返回 | `Close` 或右上角关闭图标 |

### 图片生成提示词

```text
Generate INVITE-01 using the shared Many Worlds visual system above.

Create a desktop Room Waiting page with a large, elegant sharing modal centered over a lightly dimmed background. The background should only hint at the room "Night Council" and role selection; do not make the room content compete with the modal.

The modal is 980px wide, white, rounded 20px, with a clear close icon in the upper-right. At the top, show a compact room identity row: a small cinematic Rome thumbnail, "Caesar: The Last Spring of the Republic", room name "Night Council", and compact status pills "Waiting" and "3 / 6 players".

Below it, create a prominent but tasteful purple-to-violet reward card. Include:
Eyebrow: "Invite friends & earn rewards"
Headline: "Earn up to 50 Bonus Credits"
Body: "Get 25 Bonus Credits for each new friend who joins and completes the opening."
Progress: a slim progress bar labeled "0 of 2 rewards unlocked"
Small honest note: "Sharing alone does not grant Credits."

Below the reward card, use a two-column layout.

Left column title: "Share your invitation"
Subtitle: "Bring friends into Night Council and shape one shared outcome."
Show six equal, polished social share tiles with recognizable but restrained icons and labels: WhatsApp, Telegram, Discord, Facebook, X, and Copy link. The primary purple gradient button below them says "Share invitation". The social tiles are secondary actions, not six competing primary buttons.

Right column title: "Invite poster"
Show a small 4:5 vertical poster preview containing the Many Worlds logo, Rome imagery, the words "Night Council", "A shared story room awaits", and a visible but non-functional QR-code placeholder. Below the preview, show an outlined button "Download poster" and a muted note "Perfect for group chats and social posts."

At the bottom of the modal, add a compact info row with a link icon and a shortened invitation URL, plus a small button "Copy link". Do not show a raw room code. Do not show account balances, payment details, player emails, hidden role content, referral dashboards, or fake earned Credits.
```

## 7. INVITE-02：社交分享完成状态

**页面目的**：用户点击某个渠道后，得到明确的“已准备好分享”反馈；不会误以为奖励已经到账。

**唯一主操作**：`Share another way`

**说明**：浏览器实际会打开原生分享、社交平台 URL 或复制到剪贴板；此图只设计回到产品后的确认状态，不模拟第三方平台界面。

### 图片生成提示词

```text
Generate INVITE-02 using the shared Many Worlds visual system above.

Create the same Invite friends & earn rewards modal as INVITE-01, but show a post-share confirmation state after the user selected "Copy link". Keep the same room identity row, same reward card, same modal dimensions, same two-column structure, and same poster preview.

Near the social share section, display a calm green confirmation strip with a check icon:
Title: "Invitation link copied"
Body: "Send it to friends and they can join Night Council."

The reward card must remain honest and unchanged:
"0 of 2 rewards unlocked"
"Friends must join and complete the opening before you earn Bonus Credits."

Make "Share another way" the single primary purple gradient button. Keep the social share tiles visible but subdued. Keep "Download poster" as an outlined secondary action.

Do not show "Reward earned", "Credits added", fake social engagement counts, a social feed, or a third-party social media page. The design must clearly distinguish a completed share action from a qualified referral reward.
```

## 8. POSTER-01：竖版邀请海报

**目的**：用户下载后可发到聊天群、私信、朋友圈或社交平台；海报的职责是吸引被邀请者扫码/访问，而不是展示复杂产品信息。

**尺寸**：`1080 × 1350`，4:5 竖版；适用于 Instagram feed、Facebook post、Discord/Telegram/WhatsApp 转发预览。

**海报必须展示**：

```text
Many Worlds logo
Caesar: The Last Spring of the Republic
Night Council
"A shared story room awaits"
"Choose a role. Shape one outcome."
Join link short text: manyworlds.com/join
Large QR code placeholder
```

**海报不要展示**：奖励金额、Host 姓名、房间原始邀请码、玩家名单、付款、Credits 余额、复杂玩法说明。

> 图像生成器无法可靠生成可扫码二维码。生成图中使用位置和比例正确的 QR placeholder；实际产品导出海报时必须用真实邀请 URL 动态覆盖该区域。

### 图片生成提示词

```text
Generate POSTER-01 as a single vertical 4:5 social invitation poster, exactly 1080 x 1350 pixels, for Many Worlds.

Visual direction: cinematic historical Rome at sunset, warm amber stone architecture and distant figures, framed as refined editorial poster art. Blend the image into a premium violet, midnight navy, and warm gold composition. It should feel like a collaborative interactive story invitation, not a movie poster and not a battle game advertisement.

Layout:
- Top: Many Worlds logo and the small tagline "AI-powered story rooms".
- Upper-middle: large title "Caesar: The Last Spring of the Republic".
- Middle: room name in a rounded translucent pill, "Night Council".
- Lower-middle: headline "A shared story room awaits" and short line "Choose a role. Shape one outcome."
- Bottom: a clearly reserved white or pale-lavender QR-code placeholder block, about 250px square, with the small caption "Scan to join".
- Under the QR block: "manyworlds.com/join".

Use excellent typography hierarchy, substantial whitespace, high contrast, and a clean safe margin around all edges. Do not include a reward promise, price, payment content, host name, raw room code, player list, social-media logos, small unreadable text, fake functional QR code, or busy UI panels.
```

## 9. 产品实现时的点击规则

这些规则不要求出现在海报中，但邀请中心设计必须为它们预留。

| 用户点击 | 产品动作 | 用户看到的结果 |
|---|---|---|
| `Invite Friends` | 打开 INVITE-01 分享中心 | 房间摘要、奖励规则、社交渠道、海报 |
| WhatsApp / Telegram / Discord / Facebook / X | 调用渠道分享 URL 或浏览器原生 Share API | 预填邀请文案与邀请链接 |
| `Copy link` | 写入剪贴板并记录渠道为 `copy` | INVITE-02 的“Invitation link copied”反馈 |
| `Download poster` | 导出 POSTER-01，并用真实邀请 URL 覆盖 QR placeholder | 下载 PNG 海报 |
| 新朋友只打开链接 | 不发奖励 | 奖励仍为 `0 of 2` |
| 新朋友加入并完成 opening | 服务端判定 qualified referral | Host 奖励进度与 Credits 余额更新 |

## 10. 生成后检查清单

- 邀请入口是一个完整的社交分享体验，不再只是右上角复制链接小框。
- 奖励信息醒目，但清楚写明：分享本身不获得 Credits，好友加入并完成 opening 后才奖励。
- 社交分享按钮覆盖 WhatsApp、Telegram、Discord、Facebook、X 和 Copy link；它们均为次级渠道动作。
- 海报有单独的下载入口，并且视觉适合社交平台转发。
- 海报二维码只作为设计占位；上线导出时必须替换为真实可扫码邀请链接。
- 没有展示房间原始邀请码、玩家邮箱、隐藏目标、私密行动、支付信息或虚假奖励到账状态。

