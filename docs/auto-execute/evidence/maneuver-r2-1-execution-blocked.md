# R2-1 OpenNovel 投影合同：执行环境阻断报告

## 结论

`CANDIDATE_BRANCH_INCOMPLETE`

R2-1 的产品修改没有提交。三次独立执行均未进入仓库 checkout、依赖安装、源码修改或测试步骤，因此不得把本轮视为通过，也不得把 0 tests 当作验收结果。

## 固定范围

- 仓库：`forwardFish/aiStoryRoom`
- 唯一分支：`feat/mvp-four-maneuver-actions`
- 用户给定起点：`104fc18c93d28556eed467b7612ec3c3b91a5bb2`
- 开始施工前远程已被并发任务前进；本轮始终使用 non-force fast-forward，未覆盖并发提交。
- R2-1 实际通用实现基线：`55952a74b32d0ef59fdcc1f4a70af2f856f5e7f6`

## 三次证据

### 尝试 1：GitHub Actions 初始化失败

- Workflow run：`31119171317`
- Job：`92676078393`
- Runner：`ubuntu-latest`
- 状态：`failure`
- 实际阶段：`Set up job`
- 错误：GitHub 无法解析/下载 Action 信息，返回 `Service Unavailable`。
- checkout：未执行
- `pnpm install`：未执行
- 产品代码：未修改
- 测试：0

### 尝试 2：Job 无步骤僵死

- Workflow run：`31121003155`
- Job：`92681488693`
- Runner：`ubuntu-latest`
- 状态：长期 `in_progress`
- Steps：无
- 日志下载：`BlobNotFound`
- checkout：未执行
- `pnpm install`：未执行
- 产品代码：未修改
- 测试：0

### 尝试 3：跨 runner 池仍无法获得执行资源

- Workflow run：`31121379028`
- Job：`92682608228`
- Runner：`ubuntu-22.04`
- 状态：长期 `queued`
- Steps：无
- 已移除仓库 workflow concurrency 阻塞后仍未启动。
- checkout：未执行
- `pnpm install`：未执行
- 产品代码：未修改
- 测试：0

## 根因分类

- 层级：`外部环境 / GitHub Actions runner allocation`
- 不是：资产、产品合同、投影、持久化、UI 或模型输出失败。
- 当前会话没有可用的本地 GitHub checkout/CLI 执行环境；GitHub connector 可以安全写 Git 对象，但不能执行 `pnpm`、TypeScript 或浏览器测试。Actions 是本轮唯一可执行环境，而三次均未进入仓库命令。

## 为什么当前方案不能成立

R2-1 要求同时完成源码开发、类型检查、OpenNovel runtime 测试、API 投影测试、Web 回归、配置校验、提交和远程回读。未获得 runner 时，任何产品提交都只能是未经执行验证的代码。按照任务约束，不能把静态计划、Mock、0 tests、历史日志或自述当作 PASS，因此没有推送未验证的 R2-1 产品修改。

## 通用替代方案

1. 在具有仓库 checkout、Node 22、pnpm 10.15、GitHub 写权限的连接编码环境中执行 R2-1；或
2. 恢复 GitHub-hosted runner 分配能力并取消僵死 run 后，重新运行同一通用实现；或
3. 使用仓库已有自托管 runner，但必须能运行完整目标 workspace 测试并保留原始日志。

不得通过故事专用词、中文正则、单场景例外、前端伪投影或删除测试来绕过。

## 清理

- 已恢复原 `.github/workflows/causal-mvp.yml`。
- 已删除临时 `.github/workflows/maneuver-r2-1.yml`。
- 已删除 `scripts/automation/r2-1-chunks/**`。
- 未提交任何半成品产品代码。
- 未修改、推送或合并 `main` / `release`。
