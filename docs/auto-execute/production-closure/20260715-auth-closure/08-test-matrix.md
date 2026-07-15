# 测试矩阵

| ID | 类型 | 场景 | 通过条件 |
|---|---|---|---|
| EMAIL-01 | Unit/API | register | 无 token 回显、token hash/发送记录存在 |
| EMAIL-02 | API/DB | verify/replay/expired | 一次成功，第二次无副作用，过期拒绝 |
| EMAIL-03 | API | resend | 对外统一 accepted、旧 token 失效、限流 |
| EMAIL-04 | API | reset | 不枚举，旧密码失效，reset 重放拒绝 |
| EMAIL-05 | Guard | 未验证业务访问 | rooms/credits/billing 等受保护入口拒绝 |
| EMAIL-06 | Provider | file sink/production config | sink 可读回；production 缺配置 readiness fail |
| GOOGLE-01 | Unit | verifier | valid/invalid aud/iss/exp/nonce/sub |
| GOOGLE-02 | API/DB | challenge replay | 首次消费，重复/过期无用户副作用 |
| GOOGLE-03 | API/DB | create/repeat/concurrent | 一个 subject 仅一个 identity/user |
| GOOGLE-04 | API | link policy | Gmail/Workspace 安全关联；第三方邮箱拒绝静默合并 |
| GOOGLE-05 | Browser | GIS contract | 官方按钮、错误恢复、登出、returnTo invite 保留 |
| AUTH-INT-01 | Integration | 邮箱/Google登录后业务调用 | 正确会话通过；禁用/未验证拒绝 |
