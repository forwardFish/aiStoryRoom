# Pressure GET `/game` 实时执行检查点

更新时间：2026-08-15 02:50 +08:00

## Git 与基线

- 工作树：`D:\tmp\aiStoryRoom-chatgpt-pro-pressure-performance-v2`
- 分支：`codex/chatgpt-pro-pressure-performance-v2`
- `HEAD`：`a98ef29c43545ebef985176e952fc756b33bcce1`
- tracking `origin/main`：`a98ef29c43545ebef985176e952fc756b33bcce1`
- 实时远程 `main`：`a98ef29c43545ebef985176e952fc756b33bcce1`
- 远程专用分支：尚未创建
- 状态：未暂存、未提交、未推送、未合并、未部署、未迁移

本任务的模块改动仍在专用分支工作树中。`docs/auto-execute/latest/HANDOFF.md` 是 2026-05-14 的其他任务遗留，不是本任务检查点。

## ChatGPT Pro 普通 Chat

### M5B 请求级观测接线

- 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f54af-4b20-83e8-9608-d1011822408d`
- 当前页面事实：仍显示 `Stop answering`，正在处理依赖、构建和 observer 测试。
- 动作：不得中断、催促、重发或另开重复 M5B。
- 工件：尚未出现可下载 ZIP。

### M4D1 access 2 SQL -> 1 SQL

- 模块任务书：`32-chatgpt-pro-m4d1-access-single-query-taskbook.md`
- 最小脱敏 ZIP：`D:\tmp\Pressure_GET_game_M4D1_access_single_query_minimal_a98ef29c.zip`
- 大小：`223,479 bytes`
- SHA-256：`FEB020E4AF25D0E1E2838CE6588AE6C8FA3C328A23394BD22D66F4AB3B5CD09E`
- 密钥扫描：禁止文件名 `0`，高置信内容命中 `0`
- 上传状态：网页文件选择事件未触发；Windows 原生窗口检查也没有文件选择器，故未上传。
- 内联回退包：11 个完整相关文件 + 3 个完整 Prisma model，`48,982 UTF-8 bytes`，SHA-256 `9CC0B42A59B509220A3FF51F3D8D77B72DA6F2F31BD2F0D2C63F0EAD34F103B7`。
- 内联提交结果：页面响应超时；检查后没有生成新对话 URL，项目首页仍在，因此不得视为已发送，也不得盲目重发。
- 下一动作：待网页恢复后先检查项目首页草稿；只有确认草稿未发送且输入状态明确，才发送一次 M4D1。

## 已完成模块

- M5C runner 已机械落地；Codex 对 Node 24 + `tsx` 的 CJS/ESM 导入做窄兼容修正。
- M5C 聚焦验收：`18/18 PASS`，`git diff --check PASS`。
- 真实三 API / Supabase / observation log / p50 / p95：`TESTS_NOT_RUN`。

## 真实验收准备

- `.env.test` 存在于主工作树，包含 `DATABASE_URL` 与 `API_PORT`；不复制进分支或工件。
- 其余 scope、allowlist、mode、独立端口环境变量必须仅在验收进程内设置。
- `3104` 已被主仓库 API 占用，禁止停止；候选端口使用 `3113`、`3114`、`3115`。
- 固定执行一次 REPLAY/SHADOW/FAST 比较、`1 cold + 10 warm`、一次 N1 SQL7 submit 与 N2 readback；不自动重跑整个 workflow。

## 下一顺序

1. 仅检查 M5B 是否完成或请求输入；完成后下载并独立验收。
2. 网页恢复后只发送一次 M4D1；验证并落地其工件。
3. 根据 M5B 实际接口编写并发送不重叠的 M4D2。
4. 统一离线功能门一次。
5. 真实三模式和 SQL/延迟验收一次。
6. 全部通过后按准确路径暂存、提交并推送专用远程分支。
