# ChatGPT Pro 普通 Chat 任务书：I1 将已验收 M1/M3 移植到最新 main

> 状态：`READY_FOR_PRO_CHAT`。本任务只做兼容移植，不新增性能架构，不接数据库、不接 HTTP、不启用 FAST。

## 背景与唯一目标

Pressure GET `/game` SQL7 式优化的 M1 快照合同与 M3 唯一投影入口已经在冻结基线
`b6f512442f7e67d6c6d0dcaa2e6449bdd849de44` 上通过独立聚焦验收。当前 `origin/main`
已经前进到 `29b3b0ad7e5201f3592748c87a0ba78126669347`，其中 Pressure 投影、Narrative authority 与产品接线发生变化。

你必须基于提供的最新 main 源码，机械保留已验收 M1 语义，并把 M3 适配到最新 main 的唯一
投影权威。最终产物必须能在最新 main 输入树上应用；不得把旧版 `game-projection.service.ts`
整文件覆盖到新 main。

## 输入与证据

- 最新 main：`29b3b0ad7e5201f3592748c87a0ba78126669347`。
- 冻结旧基线：`b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- 输入 ZIP：`Pressure_GET_game_I1_latest_main_29b3b0ad_M1M3_port_source.zip`。
- 输入 ZIP 大小与 SHA-256：由上传该 ZIP 的同一条 Chat 消息给出；ZIP 根目录 `SOURCE_MANIFEST.json` 提供全部输入文件的逐文件 SHA-256。
- `latest-main/`：最新 main 的任务相关源码。
- `accepted-m1-m3/`：旧基线已验收的 M1/M3 文件，只作为语义与测试参考，不能整树覆盖。
- `evidence/`：M1/M3 验收结论与主线漂移说明。

## 必须保留的单一权威

1. PostgreSQL/Supabase 仍是运行时权威；本任务不访问数据库。
2. M1 只负责严格解码 `GameReadSnapshotV1`，不拥有投影规则。
3. M3 必须复用最新 main 已存在的最终投影权威；不得复制章节、叙事、资源、权限或席位规则。
4. P0 chapterSource 只能用于 P0；N1-N7 必须走最新 main 的运行时 authority 路径。
5. 最新 main 的统一 story/decision turn、turn authority draft、内容包资源表达与 canonical seat 映射必须保留。
6. 公共 `PressureChapterGameProjectionV1`、HTTP 请求/响应与玩家可见页面不得改变。

## 允许修改

- `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.ts`
- `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.spec.ts`
- `apps/api/src/pressure-chapter/game-projection/game-read-snapshot-projector.spec.ts`
- `apps/api/src/pressure-chapter/game-projection/game-projection.service.ts`
- `apps/api/src/pressure-chapter/game-projection/index.ts`
- 只有最新 main 编译确实要求时，才可最小修改同目录的内部合同文件；必须在报告中逐项说明。

## 禁止修改

- `apps/web/**`、任何玩家页面、路由、文案、样式或浏览器行为。
- Prisma adapter、数据库 schema、migration、SQL、M2、M4、M5。
- HTTP facade、Product Root、环境变量、启动配置。
- Settlement、Action Guard、AI 策略、Narrator Prompt、Provider、内容包。
- 不得引入第二投影器、缓存权威、兼容 fallback 或对单节点的硬编码补丁。
- 不得 commit、push、创建 PR、部署或迁移。

## 必须实现

1. 以最新 main 为基底移植 M1 严格合同与解码测试，保持旧验收行为。
2. 在最新 `PressureChapterGameProjectionService` 上提供一个窄的 snapshot 投影入口；入口只能完成
   M1 快照到最新既有投影输入的转换。
3. 保留并适配下列回归：
   - P0 显式锁定；非 P0 chapterSource fail-closed；
   - N1-N7、六席、SOLO/TARGETED/SYNC；
   - narrative、Feed cursor/limit、resources/tokens/capabilities；
   - 最新 main 统一 story/decision turn 与 turn authority；
   - viewer 隔离、route/chapter/hash/revision/head/fence 校验。
4. 如果旧 M3 的输入不足以表达最新 main 的必需权威，必须停止并在报告中给出准确缺口；不得猜测、补默认值或复制旧逻辑。

## 必须执行的测试

只运行一次聚焦正确性门；失败后只重跑最小失败用例：

```text
node --import tsx --test \
  apps/api/src/pressure-chapter/game-projection/game-read-snapshot.spec.ts \
  apps/api/src/pressure-chapter/game-projection/game-read-snapshot-projector.spec.ts \
  apps/api/src/pressure-chapter/game-projection/game-projection.service.spec.ts \
  apps/api/src/pressure-chapter/game-projection/decision-presentation.spec.ts
pnpm --filter @apps/api typecheck
git diff --check
```

无法真实运行的命令必须标记 `TESTS_NOT_RUN`，不得以静态检查冒充。

## 必须交付

只交付一个可下载 ZIP，包含：

- `changed-files/`：相对最新 main 的完整修改文件；
- `changes.patch`：可在精确 `29b3b0ad7e5201f3592748c87a0ba78126669347` 上 `git apply --check` 的补丁；
- `manifest.json`：输入 ZIP、基线、每个文件的 path/size/SHA-256；
- `report.md`：移植策略、保留的新 main 权威、实际测试、未运行测试、风险、回滚。

ZIP 不得包含 `.git`、`node_modules`、`.env*`、凭据、连接串、运行日志、数据库内容或浏览器状态。

## 验收标准

- 补丁能机械应用到精确最新 main，且 changed-files 与应用结果逐文件一致。
- M1 严格解码及 M3 唯一投影语义未回退。
- 最新 main 的 story/decision turn、turn authority、内容资源与席位语义没有被旧文件覆盖。
- 聚焦测试、API typecheck、`git diff --check` 通过。
- 玩家可见文件修改列表为空。
- 本模块只可标记 `I1_CANDIDATE`；ChatGPT Pro 自述不等于 Codex 验收通过。

## 回滚

不应用本 ZIP 即可；本任务不接生产路径，不影响 M2/M4A 的并行开发。
