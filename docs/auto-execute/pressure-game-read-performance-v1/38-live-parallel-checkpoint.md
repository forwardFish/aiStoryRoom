# Pressure GET `/game` 并行执行检查点

日期：2026-08-15

## 分支与基线

- 工作树：`D:\tmp\aiStoryRoom-chatgpt-pro-pressure-performance-v2`
- 分支：`codex/chatgpt-pro-pressure-performance-v2`
- HEAD / `origin/main`：`a98ef29c43545ebef985176e952fc756b33bcce1`
- 远程专用分支尚未创建；未 stage、commit、push、merge、deploy 或 migration。
- 当前玩家页面、Prisma schema/migration、发布内容资产变更均为 0。

## 已验收

- M5B：`M5B_CODE_ACCEPTED`；Pro 对话 `6a7f54af-4b20-83e8-9608-d1011822408d`；ZIP SHA-256 `2011B35FDBE6AA0E4BC69F2778908F490BFAEC3D26477D356F6EA9EA20C9AD86`；Codex 聚焦门 119/119、API typecheck PASS。
- M4D1：`M4D1_CODE_ACCEPTED / REAL_DATABASE_NOT_YET_MEASURED`；Pro 对话 `6a7f6961-4fe0-83ee-8161-7d16ed0f39a6`；ZIP SHA-256 `6438FBC2AAB26A2ECAB8CD6D35CAE04BD7205331760EEB0A9F868CFB7520CC35`；官方 spec 7/7、API typecheck PASS。
- M5C runner：18/18 PASS；真实三模式运行尚未执行。

## 正在执行

- M4D2 Pro 普通 Chat：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f6d26-8034-83ee-8d1b-04a4d970345a`
- 内联关键源码包：181,253 bytes；SHA-256 `44D662C160D0B8E1BE4DC13A1F6834FEC154A80891E1F43F76C7BDD7DDF6562C`。
- 唯一范围：`pressure-chapter-http.facade.ts` 与对应 spec；FAST access 后跳过 `resolveGame/readStoredRoute`，REPLAY/SHADOW 保持旧校验。
- 当前状态：已定位并实现边界，正在构建隔离聚焦验证；尚无最终 ZIP，不得声明接受。

## 真实验收准备

- `.env.test` 权威路径：`D:\lyh\agent\agent-frame\aiStoryRoom\.env.test`；不复制入分支或工件。
- 已确认 `DATABASE_URL`、`SUPABASE_PROJECT_REF`、`API_PORT`、`EMAIL_PROVIDER`、`NODE_ENV` 存在；未输出任何值。
- Supabase project allowlist SHA-256：`eff97eef9d6b7986177cc1a80fc757395bf588e05fb1a196e731f1e869a8ef35`。
- 3113 / 3114 / 3115 当前无监听，预留给 REPLAY / SHADOW / FAST；3104 的既有主仓 API 不停止。
- 新 API 从最终隔离副本运行，使用外部 `.env.test`、`PRESSURE_CHAPTER_WORKER_OWNER=independent_worker`、独立 stdout/stderr/observation 文件。
- 因 Windows CRLF 发布物哈希门，最终隔离副本只规范化已记录的两份 action-effect compiler 工件；目标分支发布物不修改。
- Runner 从主仓 cwd 启动以读取 `.env.test`，脚本与业务代码来自专用分支/最终隔离副本。

## 下一顺序

1. M4D2 出 ZIP 后下载、hash、scope review、机械应用；
2. 只运行 M4D2 最小失败归属门，再做一次最终统一功能/typecheck/build；
3. 创建最终隔离副本，执行一套真实 REPLAY/SHADOW/FAST + 10 warm + SQL7 submit/readback；
4. 分别报告功能等价、application SQL、协议往返、事务、p50/p95；
5. 固化最终证据；显式 stage 任务路径，commit 并 push 专用分支；不 merge/deploy/migrate。
