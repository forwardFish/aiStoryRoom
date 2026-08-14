# M5A 纯观测合同与离线汇总：并行派发

记录时间：2026-08-15 00:15（Asia/Shanghai）

状态：`M5A_SENT_AND_RUNNING / NOT_DELIVERED / NOT_ACCEPTED`。

## 输入

- 任务书：`21-chatgpt-pro-m5a-pure-observation-taskbook.md`。
- 基线：`origin/main@a98ef29c43545ebef985176e952fc756b33bcce1`。
- 源码包：`Pressure_GET_game_M5A_pure_observation_source_a98ef29c.zip`。
- 大小：4,482,508 bytes。
- SHA-256：`7A594D1A1AB6F23C9A26E4A9DF291DAF9E5B2475E508AE06178583E811AABB65`。
- 文件范围：API、openovel runtime、shared/templates、Prisma schema、构建配置和根目录任务书；无 `.git`、`node_modules`、`.env*`、dist/build 或玩家 Web。
- 高特征扫描命中全部是测试中的 `secret` / `not-a-real-value` 固定占位符，不是实际凭据。

## Pro 对话

- ChatGPT Pro 普通 Chat：
  `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f3fe0-3ae4-83e9-a120-614d96cb01e3`
- 页面已验证 `Chat` 为 selected，模型为 `Pro`。
- 附件和任务已发送，页面出现 `Stop answering`。

## 并行边界

- M5A 只新增纯观测合同、纯统计和脱敏 evidence 构造；不接 HTTP、selector、ProductRoot，不修改现有 metrics 运行行为。
- M5B request-scope 和运行时接线仍等待 M4B 验收。
- M5A 工件即使通过，也不能声称真实性能、访问量或玩家功能通过。
