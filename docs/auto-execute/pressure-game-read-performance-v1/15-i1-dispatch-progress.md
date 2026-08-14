# I1 最新 main 兼容移植：派发进度

记录时间：2026-08-14

## 已完成

- M3 r2 已由 Codex 独立验收为 `M3_ACCEPTED_ON_FROZEN_BASE`。
- 已生成 I1 任务书：`14-chatgpt-pro-latest-main-m1-m3-port-taskbook.md`。
- 已生成脱敏源码包：`Pressure_GET_game_I1_latest_main_29b3b0ad_M1M3_port_source.zip`。
- ZIP 大小：1,491,391 bytes。
- ZIP SHA-256：`91B078CEC164B7A47D9F99B3F111754729B475A739CE45C8AF7F6DA765DF8576`。
- ZIP 包含精确 `29b3b0ad7e5201f3592748c87a0ba78126669347` 的相关源码、已验收 M1/M3 参考文件、逐文件 SHA-256 manifest 和任务书。
- `.git`、`node_modules`、`.env*` 检查为空；高特征凭据/连接串扫描未发现实际秘密值。

## 派发状态

- 目标为原 M3 ChatGPT Pro 普通 Chat：
  `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f10de-5724-83e8-bd46-e28431ca4add`
- 页面已验证为 `Chat` 且 `Pro`。
- 附件与任务书已成功发送；页面出现 `Stop answering`，取得正在执行的可验证状态。
- 当前标记：`I1_SENT_AND_RUNNING / NOT_DELIVERED / NOT_ACCEPTED`。
- 2026-08-15 00:02 后检查：Pro 首次停止并明确报告缺少完整 M1 两文件，未交付 ZIP；该次结果标记为 `I1_NOT_DELIVERED`，不视为开发完成。
- 已按它的准确请求补充 `Pressure_GET_game_M1_GameReadSnapshotV1_b6f512_v4_correction.zip`（58,996 bytes，SHA-256 `C59455617857AD50871DA392C9CA3E669461D12718DE69350B7A54D6EF4E5530`），要求从已完成位置继续，不重复调查。
- 补充消息发送后页面重新出现 `Stop answering`；当前恢复为 `I1_SENT_AND_RUNNING / NOT_DELIVERED / NOT_ACCEPTED`。

## 后续 main 漂移

- 准备 I1 包后，`origin/main` 持续前进；2026-08-15 检查时至少已到 `a98ef29c`。
- 新增提交主要涉及 rooms list、rooms gateway、production lobby/pool 配置；其中没有修改 I1 负责的 M1/M3 snapshot/projector 文件，但最终 ProductRoot/production composition 必须按届时最新 main 统一适配。
- 为避免追逐频繁主线提交，I1 仍以精确 `29b3b0ad` 做 Pressure 投影兼容移植；最终只在全部模块收齐后一次性把结果落到验收时最新 `origin/main`，并保留两项上游提交。
