# R2-1 OpenNovel 投影合同：历史执行环境阻断记录

## 结论

本文件只记录三次 GitHub Actions 执行环境故障，**不能用于否定分支中已经存在的产品提交**。

在这些 runner 尝试开始前，远程分支已经包含以下产品实现：

- `75cb505ca44c253a42c6c262ef8efb31b7c2f985`：R2-1 OpenNovel 谋划投影；
- `0294389d82a18ca06acb66e3906f12c25bc2f539`：R2-2 OpenNovel 谋划持久化链；
- `a5c50bb36051c272d1c10ea8d2561a4593b7e73a`：R2-3 Web 提交适配；
- `f3b956767dbc8a67e1f971ad4cce3dc570b4e509`：共享 OpenNovel storage 测试修复；
- `067f1679d77195ad00720c05b72ae1838f71e114`：正式谋划客户端模块测试接入。

准确口径是：

> 下述三次 runner 尝试没有新增产品提交，也没有产生可采用的测试结果；它们不是对上述产品提交的失败判定。

随后，本分支又继续提交了世界无关 Maneuver Package、注册表和中性第二世界 fixture。当前产品状态必须以远程最新 SHA 及独立验证结果为准，不能再使用“产品修改没有提交”的旧表述。

## 固定范围

- 仓库：`forwardFish/aiStoryRoom`
- 唯一分支：`feat/mvp-four-maneuver-actions`
- 用户给定起点：`104fc18c93d28556eed467b7612ec3c3b91a5bb2`
- 三次 runner 尝试开始时的远程节点：`55952a74b32d0ef59fdcc1f4a70af2f856f5e7f6`
- 所有分支更新均使用 non-force fast-forward；没有覆盖并发提交。

## 三次外部环境证据

### 尝试 1：GitHub Actions 初始化失败

- Workflow run：`31119171317`
- Job：`92676078393`
- Runner：`ubuntu-latest`
- 状态：`failure`
- 实际阶段：`Set up job`
- 错误：GitHub 无法解析/下载 Action 信息，返回 `Service Unavailable`。
- checkout：未执行
- `pnpm install`：未执行
- 本次尝试新增产品代码：无
- 本次尝试测试：0

### 尝试 2：Job 无步骤僵死

- Workflow run：`31121003155`
- Job：`92681488693`
- Runner：`ubuntu-latest`
- 状态：长期 `in_progress`
- Steps：无
- 日志下载：`BlobNotFound`
- checkout：未执行
- `pnpm install`：未执行
- 本次尝试新增产品代码：无
- 本次尝试测试：0

### 尝试 3：跨 runner 池仍无法获得执行资源

- Workflow run：`31121379028`
- Job：`92682608228`
- Runner：`ubuntu-22.04`
- 状态：长期 `queued`
- Steps：无
- 移除 workflow concurrency 依赖后仍未启动。
- checkout：未执行
- `pnpm install`：未执行
- 本次尝试新增产品代码：无
- 本次尝试测试：0

## 根因分类

- 层级：`外部环境 / GitHub Actions runner allocation`
- 不是：资产、产品合同、投影、持久化、UI 或模型输出失败。
- 这三次尝试均未进入仓库命令，因此不能拿来判断已有产品代码是否通过。

## 后续验证口径

- 不再循环尝试 GitHub-hosted runner；
- 不再新增临时 workflow、Base64 源码分片或 CI 传输脚手架；
- 由隔离本地克隆对远程精确 SHA 执行 typecheck、聚焦测试、PostgreSQL、浏览器和真实模型验收；
- 只有实际执行的测试命令及其原始结果可以计入 PASS；
- runner 排队、0 tests、历史日志和 HTTP 200 不能计入 PASS。

## 清理与分支安全

- 临时 `.github/workflows/maneuver-r2-1.yml` 已删除；
- `scripts/automation/r2-1-chunks/**` 已删除；
- 没有修改、推送或合并 `main` / `release`；
- 没有创建 PR，也没有部署或操作线上数据。
