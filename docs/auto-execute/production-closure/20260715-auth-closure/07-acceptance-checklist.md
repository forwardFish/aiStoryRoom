# 认证模块验收清单

- [x] A0：typecheck、API test、Web test 均可结束并返回明确 exit code。
- [ ] A1：注册不返回验证 token；新 token 模型只存哈希。
- [ ] A1：verify、resend、reset 均过期/单次使用且不共用记录。
- [ ] A1：未验证密码账号无法获得业务访问权限。
- [ ] A2：file sink 可读回，Resend 配置缺失导致 production readiness 失败。
- [ ] A3：Google ID Token 的 aud/iss/exp/nonce/sub 验证测试通过。
- [ ] A3：同 subject 幂等；第三方邮箱冲突不会静默关联。
- [ ] A4：认证 UI 支持邮箱验证、重发、重置与 Google 官方按钮；安全回跳保持 invite 参数。
- [ ] A4：无 token/nonce/credential/完整 Google subject 泄漏到响应、日志、证据。
- [ ] A5：真实邮箱、真实 Google staging 登录、部署配置和数据库读回有脱敏证据。
