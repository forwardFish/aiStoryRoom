# M4A REPLAY/SHADOW/FAST 纯选择器：离线验收

记录时间：2026-08-15

状态：`M4A_OFFLINE_ACCEPTED / NOT_WIRED`。

## 工件

- 文件：`Pressure_GET_game_M4A_mode_selector_b6f512.zip`
- 大小：18,924 bytes
- SHA-256：`EB2786D0E8829AFE0FC23CAB662E51FA71B68C202E5531F78EFAF4C0E5EC5090`
- changed-files 仅包含 selector 和 selector spec；无数据库、HTTP、ProductRoot、页面或配置修改。
- 两个文件的 Git 规范化 blob 与工件逐一一致；高特征密钥扫描无实际凭据命中。

## 独立复核

- 在干净 detached `b6f51244 + accepted M1` 树机械应用 patch 无冲突。
- M4A+M1 聚焦测试：63/63 PASS，其中 selector 43 项、M1 20 项。
- `pnpm --filter @apps/api typecheck`：PASS。
- `git diff --check`：PASS。
- REPLAY 只读 legacy；SHADOW 返回 exact legacy 并隔离 candidate/diagnostic 错误；FAST 不调用 legacy且 candidate 错误 fail-closed。
- shadow diagnostic 合同仅包含固定安全字段；selector 无环境、Prisma、写入、缓存、重试或页面依赖。

## 证据边界

- M4A 尚未接入 ProductRoot/HTTP，所以不能证明真实 GET 使用了正确模式、SQL 数下降或玩家响应等价。
- M4B 必须只做 composition，不得修改 M4A 业务逻辑；默认模式必须保持 `REPLAY`。
