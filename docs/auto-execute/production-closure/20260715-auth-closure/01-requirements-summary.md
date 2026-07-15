# 认证需求摘要

| ID | 优先级 | 需求 | 当前状态 |
|---|---|---|---|
| AUTH-EMAIL-01 | P0 | 注册不签发业务 token，验证邮件可送达 | 未实现 |
| AUTH-EMAIL-02 | P0 | 验证、重发、重置令牌隔离、哈希、过期、单次使用 | 未实现 |
| AUTH-EMAIL-03 | P0 | 密码登录和业务写操作拒绝未验证账号 | 部分实现；Guard 未收口 |
| AUTH-EMAIL-04 | P0 | 忘记密码不枚举账号，旧密码失效 | 部分实现；无生产投递 |
| AUTH-EMAIL-05 | P1 | 注册/登录/重发/重置限流与审计 | 未实现 |
| AUTH-GOOGLE-01 | P0 | GIS 官方按钮、服务器 ID Token 验证 | 未实现 |
| AUTH-GOOGLE-02 | P0 | Google `sub` 身份映射、nonce 防重放 | 未实现 |
| AUTH-GOOGLE-03 | P0 | 安全账号关联及第三方邮箱冲突保护 | 未实现 |
| AUTH-GOOGLE-04 | P1 | 保留 invite/room/ref/channel 安全回跳 | 未实现 |

本模块不把 Google、邮箱或支付测试桩视为生产闭环证据；真实第三方证据在代码 Gate 后单独补充。
