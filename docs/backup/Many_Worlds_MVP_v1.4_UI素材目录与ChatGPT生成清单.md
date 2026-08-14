# Many Worlds MVP v1.4 UI 素材目录与 ChatGPT 生成清单

> 文档状态：PLANNED
> 目的：告诉用户哪些图片已经有、哪些还缺、应该放到哪里。目录保持简单，适合直接用 ChatGPT 生成后上传。

## 1. 最简目录

```text
docs/UI/web/assets-source/
├─ backgrounds/
├─ portraits/
├─ posters/
└─ icons/
```

规则：

- 现有 `docs/UI/web/pic/` 和 `docs/UI/web/icon/many-worlds-icons-clean/` 不搬动、不改名。
- 只有后续新生成或替换的素材放入 `assets-source/`。
- 页面参考图仍放在 `docs/UI/web/` 根目录，不放进 assets-source。
- 每张新图使用稳定英文名或 `功能-序号`，禁止继续把时间戳文件名写进运行时代码。

### 1.1 页面参考图统一命名

2026-07-14 已将 `docs/UI/web/` 根目录下 13 张 ChatGPT 时间戳参考图改成流程名：

| 流程阶段 | 新文件名 |
|---|---|
| 登录/注册 | `MW-10_AUTH_登录注册.png` |
| 世界详情 | `MW-20_WORLD_世界详情_凯撒.png` |
| 房间列表 | `MW-30_ROOMS_房间列表.png` |
| 等候房/选角 | `MW-40_ROOM_等候房与选角.png` |
| 游戏内解锁 | `MW-60_PAY-01_游戏内解锁提示.png` |
| Credits 钱包 | `MW-60_PAY-02_世界点数钱包.png` |
| 确认购买，已生成 | `MW-60_PAY-03_确认购买.png` |
| 支付处理中 | `MW-60_PAY-04_支付处理中.png` |
| 支付成功 | `MW-60_PAY-05_支付成功.png` |
| 支付取消 | `MW-60_PAY-06_支付取消.png` |
| 支付失败 | `MW-60_PAY-07_支付失败.png` |
| 游戏结局 | `MW-70_RESULT_游戏结局.png` |
| 社交分享与奖励 | `MW-80_INVITE-01_社交分享与奖励.png` |
| 邀请海报 | `MW-80_INVITE-02_邀请海报.png` |

`首页.png`、`选择角色.png`、`UI01_角色专属开场.png`—`UI08_主动谋划.png` 已经有清晰语义且被旧验收文档使用，本轮不改名。`pic/` 和 `icon/` 是运行时素材源，也不为“统一好看”而批量改名；运行时通过 asset manifest/assetKey 理解它们。

## 2. 已有素材，无需再生成

### 2.1 背景与头像

`docs/UI/web/pic/` 已有：

- 12 张 1672×941 场景背景，运行时已对应 `apps/web/public/assets/bg/1.png`—`12.png`。
- 15 张 1254×1254 透明/棋盘格头像，运行时已对应 `apps/web/public/assets/portrait/1.png`—`15.png`。
- `ChatGPT Image 2026年7月14日 20_10_29.png`：1122×1402 无字多世界海报背景，建议作为 `poster-many-worlds-base`。

后续开发先复用这些素材；除非视觉参考明确不匹配，否则不重新生成背景或头像。

### 2.2 图标

`docs/UI/web/icon/many-worlds-icons-clean/` 已有 46 个透明紫色图标，含 128、256 和 tight 三种尺寸。支付/邀请相关可直接使用：

| 用途 | 现有图标 |
|---|---|
| Logo | `01-logo-mark.png` |
| 用户/角色 | `17-user-role.png` |
| 锁定 | `14-lock.png` |
| 成功 | `15-check.png` |
| 分享 | `24-share.png` |
| 解锁 | `30-unlock-pass.png` |
| X | `32-x-twitter.png` |
| Discord | `35-discord.png` |
| 外链 | `40-external-link.png` |
| 链接 | `41-link.png` |
| 邀请网络 | `42-people-network.png` |
| 信息 | `43-info.png` |
| 卡片/支付 | `46-card.png` |

普通网页优先用 `png-128/`；大卡片或高 DPI 用 `png-256/`。

## 3. 已补齐的 PAY-03 页面参考图

### UI-PAY-03：确认支付页

保存到：

```text
docs/UI/web/MW-60_PAY-03_确认购买.png
```

实际尺寸：1486×1058。
SHA-256：`F1725E2F86AC7494507EB97E3A2A2D3419823910BE8235E22267D9C2FC14B8B9`。

该图已按 `docs/Many_Worlds_P0支付与分享_ChatGPT图片生成提示词_v1.0.md` 第 6 节生成并完成静态检查：

- 复用 World Credits Header 和容器。
- 只有订单摘要，不出现银行卡输入。
- 显示 300 Credits、$7.99、当前 40、支付后 340。
- 显示返回 `Night Council · Round 4 of 7`。
- 主按钮为 `Continue to secure payment`。

结论：无需重新生成。PAY-03 缺图阻塞已经解除；后续仍需实现真实页面，并以 1486×1058 原生尺寸生成 actual/diff/metrics 后才能通过一比一验收。

## 4. 目前必须补充的图标

现有图标包缺少：

```text
social-whatsapp.png
social-telegram.png
social-facebook.png
```

保存到：

```text
docs/UI/web/assets-source/icons/
```

建议每张 256×256、透明背景、图标居中、保留 24px 安全边距。可以把下面提示词分别交给 ChatGPT：

```text
Create one clean 256x256 transparent PNG social sharing icon for WhatsApp.
Use the recognizable brand symbol, centered, crisp, no text, no card background,
no shadow, no border, generous transparent padding. Product UI icon, not an illustration.
```

把 WhatsApp 分别替换成 Telegram、Facebook 生成另外两张。若 ChatGPT 生成的品牌符号失真，优先改用官方品牌 SVG，再导出透明 PNG；不要上线一个看不出平台的近似图标。

不需要再生成 X 和 Discord，它们已经在现有包中。

## 5. 邀请海报素材

已有完整参考：

```text
docs/UI/web/MW-80_INVITE-02_邀请海报.png
```

已有无字底图：

```text
docs/UI/web/pic/ChatGPT Image 2026年7月14日 20_10_29.png
```

产品实现应使用无字底图动态叠加 Logo、世界名、房间名、文案和真实二维码。完整参考图只用于对比，不能直接下载给用户，因为它的二维码和文案不是动态数据。

如果想换成更符合 `Night Council` 的罗马海报背景，生成后保存为：

```text
docs/UI/web/assets-source/posters/poster-caesar-night-council-base.png
```

提示词：

```text
Create a single text-free vertical 4:5 poster background, 1080x1350 pixels.
Cinematic historical Rome at sunset, warm amber stone, elegant violet and midnight navy atmosphere,
premium collaborative interactive-story mood, large clean negative space in the upper and middle areas
for product typography, and a quiet dark lower area for a QR block.
No logo, no words, no UI panels, no QR code, no modern objects, no battle scene.
```

该替换不是 P0 必须项；现有无字多世界底图已经可以开发和测试动态海报。

## 6. 可选背景和头像的生成规则

只有现有 `pic/` 确实没有合适素材时才新增：

### 背景

保存到 `assets-source/backgrounds/`，建议 1672×941。

```text
Create one text-free 16:9 cinematic environment background for Many Worlds.
Keep the lower third darker and visually quiet for readable interface overlays.
No logo, no text, no UI, no watermark, no close-up faces.
```

### 头像

保存到 `assets-source/portraits/`，建议 1254×1254 透明 PNG。

```text
Create one square chest-up character portrait for Many Worlds on a transparent background.
Realistic cinematic lighting, centered face, clean silhouette, no text, no frame, no props touching edges.
```

## 7. 上传后的检查清单

- 文件能以 UTF-8 路径读取，没有损坏。
- 尺寸和透明背景符合要求。
- 图标没有文字、白底卡片、阴影边框或水印。
- 背景没有 UI、Logo、假按钮或不可读文字。
- 海报底图没有固定二维码；二维码由产品动态生成。
- 新文件写入 asset manifest，记录 source path、hash、尺寸、用途和 replacementStatus。
- 产品运行时代码只引用稳定文件名/assetKey，不引用 ChatGPT 时间戳文件名。
