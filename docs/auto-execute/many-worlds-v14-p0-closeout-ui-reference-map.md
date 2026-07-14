# Many Worlds v1.4 P0 Closeout UI Reference Map

本映射将每张参考图绑定到唯一页面或状态，缺少参考图时不得自行发明视觉真源。

| UI ID | Reference | Runtime state | Route/component | Status |
|---|---|---|---|---|
| UI-AUTH-01 | `docs/UI/web/MW-10_AUTH_登录注册.png` | login/signup | `/auth` | existing/regression |
| UI-WORLD-01 | `docs/UI/web/MW-20_WORLD_世界详情_凯撒.png` | Caesar detail | `/worlds/caesar` | existing/regression |
| UI-ROOMS-01 | `docs/UI/web/MW-30_ROOMS_房间列表.png` | rooms list | `/rooms` | existing/regression |
| UI-ROOM-01 | `docs/UI/web/MW-40_ROOM_等候房与选角.png` | waiting room | `/rooms/:roomId` | existing + invite trigger |
| UI-PAY-01 | `docs/UI/web/MW-60_PAY-01_游戏内解锁提示.png` | insufficient credits | room-game modal | required |
| UI-PAY-02 | `docs/UI/web/MW-60_PAY-02_世界点数钱包.png` | wallet/package choice | `/credits` | required |
| UI-PAY-03 | `docs/UI/web/MW-60_PAY-03_确认购买.png` (1486×1058, SHA-256 `F1725E2F...14B8B9`) | internal confirmation | `/credits` state | CONFIRMED_SOURCE |
| UI-PAY-04 | `docs/UI/web/MW-60_PAY-04_支付处理中.png` | pending | `/credits/status` | required |
| UI-PAY-05 | `docs/UI/web/MW-60_PAY-05_支付成功.png` | paid/unlock/return | `/credits/status` | required |
| UI-PAY-06 | `docs/UI/web/MW-60_PAY-06_支付取消.png` | returned unpaid | `/credits/status` | required |
| UI-PAY-07 | `docs/UI/web/MW-60_PAY-07_支付失败.png` | terminal/create error | `/credits/status` | required |
| UI-RESULT-01 | `docs/UI/web/MW-70_RESULT_游戏结局.png` | dynamic result | `/game/result` | existing + low-weight Share Recap |
| UI-INVITE-01 | `docs/UI/web/MW-80_INVITE-01_社交分享与奖励.png` | room invite modal | room modal | required |
| UI-POSTER-01 | `docs/UI/web/MW-80_INVITE-02_邀请海报.png` | downloaded poster | canvas/export | required |

Asset source remains intentionally simple: `docs/UI/web/assets-source/{backgrounds,portraits,posters,icons}/`. Existing `pic/` and icon pack remain authoritative and are not bulk-renamed.

UI-PAY-03 now exists and is the pixel reference. T08 must capture the implementation at its native 1486×1058 viewport and must still reject any invented credit-card form or prompt-only substitute.
