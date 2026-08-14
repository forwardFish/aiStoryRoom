# M1 GameReadSnapshotV1 独立验收

## 结论

`M1_ACCEPTED`。

本结论只覆盖 M1 的合同、严格解码、聚焦测试和编译边界；不覆盖 M2-M5、Prisma 聚合读取、HTTP 接线、SHADOW/FAST、真实 Supabase、SQL 数、协议往返、事务、warm p50/p95 或玩家流程。

## 精确基线与开发来源

- 工作树：`D:/tmp/aiStoryRoom-chatgpt-pro-pressure-performance-v2`。
- 分支：`codex/chatgpt-pro-pressure-performance-v2`。
- Git 基线：`origin/main@b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`。
- ChatGPT Pro 普通 Chat：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7db677-d748-83ea-b90f-e8eeb62c2f55`。
- 最终候选工件：`Pressure_GET_game_M1_GameReadSnapshotV1_b6f512_v4_correction.zip`。
- 工件大小：`58,996` bytes。
- 工件 SHA-256：`C59455617857AD50871DA392C9CA3E669461D12718DE69350B7A54D6EF4E5530`。
- 工件 manifest、changed-files、patch 和 report 的声明大小及 SHA-256 全部复算一致。
- 高置信凭据扫描无命中。

## 准确修改范围

生产代码：

- `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.ts`
- `apps/api/src/pressure-chapter/game-projection/index.ts`

聚焦测试：

- `apps/api/src/pressure-chapter/game-projection/game-read-snapshot.spec.ts`

没有修改 Prisma、HTTP、公开响应、数据库 schema/migration、Settlement、Provider、Prompt 或 `apps/web/**`。M1 未接入旧 GET，所以当前玩家行为和访问数量均未变化。

## 最终输入树哈希

Windows 工作树使用 CRLF；与 Pro v4 changed-files 做 LF 归一化后 3/3 内容完全一致。

| 文件 | 工作树大小 | 工作树 SHA-256 |
|---|---:|---|
| `game-read-snapshot.ts` | 66,067 | `E614C3E5F124F01B7848CD1218D92F627D933446E7FD5192C41AD603518C4280` |
| `game-read-snapshot.spec.ts` | 54,315 | `AE8D877827BD16709AFFEB336A70F88B81B114164F3BCFF7AA56E95D283E3431` |
| `index.ts` | 182 | `FE1F861B85855773D1C29FA6D16F8114ABAD15FD847755E37514EB061E3FA3E3` |

## 独立正确性证据

首次、单次执行：

```powershell
node --import tsx --test apps/api/src/pressure-chapter/game-projection/game-read-snapshot.spec.ts
```

结果：`20/20 PASS`，0 failed，约 1.16 秒。

首次、单次执行：

```powershell
pnpm --filter @apps/api typecheck
```

结果：`PASS`，exit 0，约 14.4 秒。

补丁反向检查和 `git diff --check` 均通过。

## 独立审查结论

- 代码/规范/安全审查：`APPROVE`，CRITICAL/HIGH/MEDIUM/LOW 均为 0。
- 架构审查：`CLEAR`。
- DecisionPin 使用 canonical deep hash 与 Working `nextDecisionPin` 全量交叉绑定。
- A-Emotion v1 要求 root event 等于当前 event；v2+ 保留原始 causal root，复用既有 identity 语义。
- 世界指标使用共享 `TRACK_IDS_V1`，拒绝未知、重复和缺失 track。
- Feed 页只调用既有 `projectAEmotionFeedPageV1()`；M1 未创建第二套排序、分页、flags 或 cursor 规则。
- capability 只输出既有权威输入，不重算最终 permission booleans。
- P0、N1-N7、六席和 SOLO/TARGETED/SYNC 均在聚焦合同测试覆盖范围内。

## 风险与下一步

M1 只是纯 decoder。M2 必须证明一条参数化、只读 Prisma SQL 能生成该精确 raw row，且 0 transaction、0 write；M3 仍需证明正式 Projector 的逐字段等价。A-Emotion v2+ 如未来增加更强 root 约束，必须在共享 A-Emotion authority 中修改，不能在 M1 建第二权威。

下一门：仅进入 M2 Prisma 聚合快照读取器，不提前接 HTTP 或 FAST。
