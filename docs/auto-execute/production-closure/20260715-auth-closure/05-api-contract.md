# API 契约

## 邮箱认证

| 方法/路径 | 请求 | 成功响应 | 错误/安全要求 |
|---|---|---|---|
| `POST /api/v4/auth/register` | email/password/nickname/referralCode | `accepted`, `verificationRequired` | 不返回 token；不枚举已存在账号 |
| `POST /api/v4/auth/verification/resend` | email | `accepted` | 始终相同结构、使旧验证 token 失效、限流 |
| `POST /api/v4/auth/verify` | token | accessToken/user | 原子消费、过期/重放无副作用 |
| `POST /api/v4/auth/login` | email/password | accessToken/user | 未验证返回 `EMAIL_VERIFICATION_REQUIRED` |
| `POST /api/v4/auth/password-reset/request` | email | `accepted` | 不枚举、仅邮件投递 |
| `POST /api/v4/auth/password-reset/confirm` | token/password | `reset` | 单次使用，旧密码失败 |

## Google 身份

| 方法/路径 | 请求 | 成功响应 | 错误/安全要求 |
|---|---|---|---|
| `POST /api/v4/auth/google/challenge` | 无 | challengeId/nonce/expiresAt | 高熵 nonce、五分钟、限流 |
| `POST /api/v4/auth/google` | credential/challengeId/returnTo | accessToken/user/returnTo | 验签 aud/iss/exp/nonce；原子消费 challenge |
| `POST /api/v4/auth/google/link` | credential/challengeId | identity | AuthGuard；显式关联；不能抢占他人 subject |
| `DELETE /api/v4/auth/google/link` | 无 | unlinked | 不得移除唯一登录方式 |

所有 `returnTo` 只允许以单个 `/` 开头、不能以 `//` 开头、不含反斜线；前端附带 invite 参数但后端不接受外站跳转。
