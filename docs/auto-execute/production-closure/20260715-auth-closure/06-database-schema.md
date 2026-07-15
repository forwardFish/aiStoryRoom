# 数据模型计划

- 新增 `AuthOneTimeToken` 与 `AuthTokenPurpose`：替代 `User.verificationTokenHash` 的生产写入；保留旧字段一个发布周期。
- 新增 `AuthIdentity` 与 `AuthProvider.GOOGLE`：唯一键 `(provider, providerSubject)`，email 仅为辅助/冲突检测字段。
- 新增 `AuthLoginChallenge`：仅存 `nonceHash`，默认 300 秒、一次消费。
- `User` 增加 `authIdentities` 关系；密码仍为可选，Google-only 用户不需要伪造密码。
- 所有 schema 变更为 additive migration；生产迁移前要求暂停本地占用 Prisma 引擎的 API 或在隔离部署环境执行。
