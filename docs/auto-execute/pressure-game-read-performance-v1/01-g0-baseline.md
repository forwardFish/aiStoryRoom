# G0 修改前基线记录

## 结论

`BASELINE_REMEASURE_BLOCKED_BEFORE_DATABASE`。

精确基线 `origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44` 的隔离 API 在监听端口前 fail-closed，未发起真实 GET，也未访问 Supabase。因此本次没有新增 SQL、协议往返或事务样本，不能把启动失败写成性能结果。

## 隔离条件

- 工作树：`D:/tmp/aiStoryRoom-chatgpt-pro-pressure-performance-v2`。
- 分支：`codex/chatgpt-pro-pressure-performance-v2`。
- 端口：3103；未与现有 3102 服务冲突。
- `PRESSURE_GAME_READ_MODE=REPLAY`。
- `PRESSURE_CHAPTER_WORKER_OWNER=independent_worker`、`STORY_WORKER_ENABLED=false`，API 不拥有 Pressure worker lanes。
- 使用本机既有 `.env.test`，没有复制到源码包或仓库。

## 唯一失败

```text
SANGTIAN_ACTION_RELEASE_ARTIFACT_HASH_MISMATCH
releaseManifest.artifacts.action_effect_compiler_core
EXPECTED_70a47dcb3a3e28e3c8261865f45a4c0834c22b261629a592a1bc4a3f7ea95f63
```

失败发生于 Nest 依赖构建阶段，调用链到 `packages/templates/src/pressure-chapter/release/loader.ts`。该问题不在 GET 聚合快照允许修改范围内，本任务不修复、不吸收主工作树中可能相关的其他修改。

原始日志位于 gitignored 路径：

- `scripts/acceptance/generated/pressure-game-read-performance-v1/g0/api.stdout.log`
- `scripts/acceptance/generated/pressure-game-read-performance-v1/g0/api.stderr.log`

## 暂用参考基线

在启动阻塞解除并且只允许一次真实重测前，沿用主任务书已记录的诊断参考，不提升为新实测：

| 范围 | application SQL | 协议往返 | 事务尝试 |
|---|---:|---:|---:|
| 普通 GET `/game` | 约 40 | 约 80 | 约 11 |
| SQL7 POST + 一次 GET | 约 47 | 约 90 | 约 12 |

状态仅为 `REFERENCE_BASELINE / G0_REMEASURE_OPEN`，不得标记 `PERF_MEASURED` 或 `PERF_PASS`。

## 下一步约束

M1 是纯合同和严格解码，不依赖 API 启动或数据库，可独立开发和聚焦验收。M2 以后仍可离线进行，但任何 SHADOW、FAST、真实 SQL 数和 warm p50/p95 均必须等启动阻塞解决后再执行；真实测试保持一次性、失败后只跑最小失败用例。
