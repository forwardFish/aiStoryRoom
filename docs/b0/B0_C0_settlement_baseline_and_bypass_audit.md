# Our Many Worlds B0 C0：同步结算基线冻结、世界写入旁路与迁移审计

> 阶段：B0 C0 — 基线冻结与旁路审计  
> 仓库：`forwardFish/aiStoryRoom`  
> 唯一开发分支：`codex/chatgpt-pro-maneuver-evidence-v1`  
> 冻结主线基线：`e60dfd8fc9dda0459edbd37fe6be52ecd8dff1d6`  
> C0 起始候选：`d8b143186bb214fc578479102176a051e33c3bbd`  
> B0 需求文档 SHA-256：`8c3e387462139bc8da07a80703ad259cd3683e756736e752572ed5dfa9af2702`  
> 审计性质：代码与合同现状审计，不代表 C1—C9 已实现，也不授权合并 `main`

---

## 1. C0 执行结论

当前功能分支已经包含“四类谋划与调查证据”纵向基础，但尚未形成 B0 所要求的同步结算权威闭环。现状可以复用的部分主要是：

- 服务端 Preview/Commit、幂等键、Revision 与两个谋划槽位；
- `PlayerAction`、`RoleAsset`、`StoryEvent`、`StoryTaskOutbox` 等现有持久化；
- Continuous Strategy 的 `ActionWindow`、Serializable Command、`ResolutionWorkflow` 与故障恢复基础；
- Templates 中的确定性单行动 Settlement、引用校验与角色投影；
- OpenNovel Shared Runtime 的角色视角投影与 Workspace 恢复机制；
- 现有真实 `/game` 页面和 Maneuver V1 控制器。

但当前至少存在四条彼此独立的权威世界写入路线：

1. Continuous Strategy 的 `WindowResolutionService`；
2. Maneuver V1 Commit 对 `PlayerAction`、`InteractionRequestV2`、私人证据 `RoleAsset` 的直接写入；
3. OpenNovel Shared Runtime 的单行动即时 `settleSingle` / Workspace 写入；
4. Solo Story Engine 的独立事务写入。

另外，`ContinuousEventDeliveryService.publish()` 接受调用方提供的具体接收用户和角色 ID；Templates Runtime Contract 与 Projection 仍使用 `affectedActorIds`。这两处构成 B0 Typed Audience 迁移前必须关闭的静态接收者旁路。

因此，B0 不应再建立平行 Engine。正确迁移方向是：

```text
现有四类谋划 / Solo / V2 / OpenNovel Shared
                ↓ Adapter
统一 ActionContract / LockedIntent
                ↓
SettlementSnapshot
                ↓
settleBatch(intents[])
                ↓
SettlementResolution + Commit Manifest
                ↓
唯一原子 Commit + Outbox
                ↓
Typed Audience 解析
                ↓
结构化结果先发布，Narrative 异步补充
```

---

## 2. 本阶段冻结的 B0 产品与工程边界

### 2.1 B0 要实现的唯一闭环

```text
实时交流
→ 玩家草拟一个主要计划
→ ActionContract 编译和预览
→ 玩家确认并准备
→ 全员准备或服务端截止时间触发冻结
→ 同一 Window 的所有 Locked Intent 共享一个 Snapshot
→ 进入同一个 SettlementBatch
→ 统一关系图、冲突组与 WorldDelta 合并
→ 一次原子 Commit
→ worldSequence 只推进一次
→ Typed Audience 发布角色差异化结构化结果
→ Narrative 异步补充
→ 下一局势窗口
→ 六个窗口后终局
```

### 2.2 C0 冻结的硬性不变量

| ID | 不变量 | 后续主要落地阶段 |
|---|---|---|
| B0-I01 | Settlement/API Commit 是权威世界唯一最终写入口 | C2 |
| B0-I02 | 一个 Window 只创建一个 Batch | C3 |
| B0-I03 | 一个 Batch 只绑定一个不可变 Snapshot | C2/C3 |
| B0-I04 | 一个 Window 只进行一次原子 Commit | C2 |
| B0-I05 | 一个 Window 的 `worldSequence` 只推进一次 | C2/C4 |
| B0-I06 | Intent 到达顺序、网络速度、模型速度和文本长度不产生优先权 | C4 |
| B0-I07 | PRIVATE、Trace、Knowledge 和 Cross-player Impact 经 Typed Audience 解析 | C5 |
| B0-I08 | Narrative 不创建、扩大或修改权威事实 | C6 |
| B0-I09 | Narrative 失败不阻塞已提交世界或下一 Window | C2/C6 |
| B0-I10 | Solo 与 Multiplayer 复用同一 Batch 底座 | C2 |
| B0-I11 | Ruleset 与 Feature Flag 在房间创建时冻结 | C1 |
| B0-I12 | 未知字段、未知引用和不明确权限 fail-closed | C1—C6 |

### 2.3 明确排除范围

C0 冻结下列非目标，不允许后续阶段为了“完整”偷偷加入：

- 多层应变链或 Reaction 触发 Reaction；
- 任意自然语言延迟条件；
- 中途加入、控制权转移、房主迁移；
- 排位、赛季、竞技积分；
- UGC 世界编辑器；
- 多世界同时首发；
- 复杂装备、技能和卡组系统；
- 正式外交承诺完整生命周期；
- B 失败后静默切换即时 A；
- 测试专用游戏页、平行主游戏页、toy HTML；
- 在通用代码中加入凯撒、布鲁图斯、西塞罗、安东尼等故事专用判断。

---

## 3. 当前仓库权威链路地图

## 3.1 Continuous Strategy / Story V2

```text
/game
→ Continuous Story V2 client
→ Rooms / Continuous Strategy API
→ ActionWindowService
→ ActionCommandService
→ PlayerAction / DecisionSubmission
→ WindowResolutionService
→ CanonFact / CanonicalEffect / Entity / Relation / Asset mutation
→ StoryEvent / EventDelivery
→ 下一 ActorTurn / Window
```

### 可复用能力

- `ActionWindow` 与 `ActorTurn` 的生命周期基础；
- Serializable transaction、乐观 Revision、幂等与有限重试；
- `ResolutionWorkflow` / `ResolutionCheckpoint`；
- `StoryTaskOutbox` 的 lease、heartbeat、重试与恢复；
- `StoryEventCursor`、`StoryEvent`、`EventDelivery`；
- 当前世界实体、关系、资源和 Canonical Fact 持久化。

### 与 B0 的差距

- 当前主要按单个 Actor/Slot 提交和解析；
- 缺少所有角色共享的不可变 `SettlementSnapshot`；
- 缺少 Window 级唯一 `SettlementBatch` 与 Commit Manifest；
- 缺少多 Intent 关系图、冲突组和排列不变性；
- `StoryEvent` 发布粒度会分别推进事件 sequence，不能直接代表 B0 Window 级 `worldSequence`；
- 发布接收者由调用方直接传入，尚未由 Typed Audience 统一解析。

## 3.2 Maneuver V1

```text
/game Maneuver Controller
→ GET projection
→ POST preview
→ 签名 Preview Token
→ POST commit
→ Serializable transaction
→ PlayerAction
→ 可选 InteractionRequestV2
→ 可选私人证据 RoleAsset
→ 返回当前角色投影
```

### 可复用能力

- 四入口统一草稿与编译合同；
- READY / REROUTE / CLARIFY / BLOCKED；
- Preview 零副作用设计；
- Preview Token、Revision 与过期校验；
- `MANEUVER_1` / `MANEUVER_2` 两个权威槽位；
- idempotencyKey；
- 当前角色联系人、Trace、筹码、证据安全投影；
- 现有 `/game` 页面控制器与预演卡。

### 与 B0 的差距

- Commit 仍直接创建正式 `PlayerAction`；
- Investigation 可在同一 Commit 中直接创建私人证据资产；
- Contact 可在同一 Commit 中直接创建 `InteractionRequestV2`；
- 不存在 `SettlementWindow`、Ready、Deadline、Snapshot、Batch 与统一 Commit；
- “正在推进”仍是当前角色行动投影，不是同一 Batch 的结构化结算状态。

### C2 迁移规则

- 保留 Preview/Commit 前端语义、所有权、Revision 和幂等校验；
- Commit 在 WINDOWED Ruleset 下只确认 `ActionContract` / Intent，不直接改变世界；
- Contact 消息若仅属于实时交流，可以继续独立记录，但不能自动生成世界事实；
- Investigation 证据必须由已提交 Batch Resolution 生成，不能由 Preview/Confirm 直接发放；
- IMMEDIATE Solo Adapter 也必须包装为单 Intent Batch，而不是保留第二套写世界逻辑。

## 3.3 OpenNovel Shared Runtime

```text
OpenNovelSharedService.submitAction
→ MultiplayerWorldRuntime.submitAction
→ compile action
→ DeterministicSettlementEngine.settleSingle
→ Workspace append events/pending
→ stateRevision + 1
→ 按角色生成 feed/projection/impact/clues/destiny-net
```

### 可复用能力

- World Module Registry；
- Workspace lock、Revision 和幂等键；
- 纯结构化 Runtime Contract；
- 每角色视角投影；
- 结构化 personal / cross-player / world echo 基础；
- Runtime 恢复、lease 和 applied sequence 相关测试基础。

### 与 B0 的差距

- 当前为单行动即时结算并直接更新 Workspace；
- 每次提交自行读取当前状态，不保证多人共享同一个 Snapshot；
- `settleSingle()` 不能表达多 Intent 关系图和 WorldDelta 合并；
- `affectedActorIds` 仍参与投影；
- API Adapter 仍把单个 Raw Text 直接送入 Runtime 写世界。

### C2/C4 迁移规则

- 在 Templates 层建立唯一 `settleBatch(input)`；
- `settleSingle()` 仅保留为 `[singleIntent]` Adapter，内部仍走 Batch；
- Multiplayer Runtime 不再接受“一个请求等于一次权威世界推进”；
- Workspace 只消费已经锁定的 Batch 与 Commit Manifest；
- 角色 Narrative 输入必须来自提交后的 Typed Audience 结果。

## 3.4 Solo Story Engine

当前 Solo Story Engine 有独立的：

- 角色与初始事实/资产种子；
- 两阶段模型执行；
- `StoryRun.stateJson`、`CanonFact`、`RoleAsset` 与故事结果事务；
- Story Package 与 Part One 确定性结算。

### B0 兼容策略

- 不改变 Solo 的即时产品节奏；
- 将一次 Solo 权威行动包装为 `IMMEDIATE` Window + 单 Intent Batch；
- 保留现有两阶段叙事和 Story Package 语义，但最终世界修改由统一 Batch Commit Adapter 完成；
- C2 先建立 Adapter，不在 C2 重新设计 Solo 内容或 UI。

---

## 4. 世界写入旁路清单

> 定义：任何能够在没有 `SettlementBatch + Commit Manifest + runId/windowId/baseWorldSequence` 完整绑定的情况下，改变权威世界、资源、关系、知识或玩家可见结构化结果的入口，均视为待迁移旁路。

| 编号 | 当前入口 | 当前写入 | 风险 | C0 结论 | 计划关闭阶段 |
|---|---|---|---|---|---|
| WB-01 | `WindowResolutionService` | CanonFact、CanonicalEffect、Entity、Relation、Asset Mutation、窗口状态 | 已有权威写入但缺 Batch Manifest 和 Window 级一次 sequence | 选为 API Commit 主落点，重构而非新建平行引擎 | C2 |
| WB-02 | `ManeuverV1PrismaWrite.createManeuverActionV1` | PlayerAction、InteractionRequestV2、RoleAsset 私人证据 | Confirm 直接产生持久变化，绕过统一 Settlement | WINDOWED 模式改为 Intent Confirm；证据由 Resolution 生成 | C2/C3 |
| WB-03 | `MultiplayerWorldRuntime.submitAction` | Workspace events、pending、stateRevision | 单行动即时写世界，提交顺序可影响后续 Snapshot | 改为 Batch 消费者；单行动 Adapter 内部走 Batch | C2/C4 |
| WB-04 | `SoloStoryEngineService` 事务路径 | StoryRun.stateJson、CanonFact、RoleAsset、事件/结果 | Solo 独立世界写引擎 | 保留产品体验，接入 IMMEDIATE 单 Intent Batch Adapter | C2 |
| WB-05 | `ContinuousEventDeliveryService.publish` | StoryEvent、EventDelivery、Cursor sequence | 调用方可直接提供具体 audience 用户/角色；每事件独立 sequence | 保留 Outbox/Delivery 存储，接收者必须来自 Typed Audience Resolver | C5 |
| WB-06 | Templates `CausalEvent.affectedActorIds` | 静态受影响 Actor 集合 | 可绕过 Typed Audience、关系参与者和观察条件 | 标记 legacy；新 B0 合同禁止作为权威接收者来源 | C5 |
| WB-07 | Templates Projection 对 `affectedActorIds` 的过滤 | 玩家可见事件/回响 | 静态 ID 可能扩大或错误缩小接收者 | 由 `TypedAudienceSpec → recipientActorIds` 的验证结果替代 | C5 |
| WB-08 | API/Runtime Narrative 发布链 | NarrativeEntry / Feed / prose | Narrative 若接收全量 Resolution 或可回写事实，会泄漏或扩大事实 | 只消费 Commit Manifest 与角色过滤结果；事实校验后发布 | C6 |
| WB-09 | 旧 Rooms / Legacy Story 路由 | 旧 StoryRun/SceneNode 等状态 | 新功能可能从旧接口绕过 Batch | 旧房间兼容；新 B0 Ruleset 的世界变化必须经过 Adapter | C2/C7 |
| WB-10 | 手工诊断与运营修复入口 | 潜在 Canon / 状态修改 | 人工修改可能破坏不可变证据链 | C8 只允许只读重放、重发 Outbox、重试 Narrative；禁止改 Canon | C8 |

### 4.1 C2 后的强制门

C2 必须增加源代码与集成测试门，阻止新 B0 世界变化直接调用：

- `canonFact.create/update/upsert`；
- `worldEntity.create/update`；
- `worldRelation.create/update`；
- `roleAssetMutation.create`；
- `StoryRun.worldSequence` 直接 increment；
- Workspace `stateRevision` 直接推进；
- EventDelivery 的具体接收人直接由业务调用方决定。

允许的例外必须显式分类：

1. 房间和角色初始化；
2. 不修改世界事实的实时聊天；
3. 旧 Ruleset 房间的兼容 Adapter；
4. 已提交 Batch 的唯一 Commit 事务；
5. Outbox / Narrative 的幂等发布状态。

---

## 5. Narrative 写事实入口审计

## 5.1 当前已有保护

仓库已有多类 Narrator/Story V4/Part One 守卫，用于拒绝：

- 新增未授权人物、文书、物件、数量和期限；
- 把玩家未执行动作写成完成事实；
- 把传闻或可观察迹象写成确认事实；
- 让 Narrator 替玩家新增命令、承诺或选择；
- 跨角苲或跨场景引用不允许的信息。

这些保护可作为 C6 Narrative Validator 基础。

## 5.2 当前不足

B0 不能只依赖“生成后文本检查”。必须在结构上做到：

```text
Commit Manifest
→ 按 recipientActorId 过滤后的结构化结果
→ Narrative Job 唯一键
→ Narrator 输入
→ 关键事实验证
→ 幂等发布
```

Narrator 永远不能接收：

- 未过滤的完整 Resolution；
- 其他角色 PRIVATE ActionContract；
- 未解析的 Typed Audience；
- 可写入资源/关系/能力的操作接口；
- 允许修改 `worldSequence` 或 Workspace Head 的权限。

## 5.3 C6 必须建立的边界

- Narrative Job Key：`runId + batchId + recipientActorId + narrativeKind`；
- Commit Manifest 不存在时不得生成或视为已应用；
- authoritative `appliedWorldSequence` 为成功依据；
- Narrative 失败只影响 prose 状态，不回滚世界；
- 下一 Window 不等待 Narrative；
- 旧 Job 不得覆盖新 guidance 或新 Narrative 版本。

---

## 6. Legacy Audience 旁路审计

## 6.1 已发现的 legacy 机制

当前通用 Runtime Contract / Projection 中仍存在：

```text
affectedActorIds
```

当前 API Event Delivery 还接受：

```text
audienceType
audienceUserIds
audienceRoleIds
```

这些字段本身可以作为最终解析结果的持久化载体，但不能继续由任意业务代码直接构造并视为权威 Audience。

## 6.2 B0 目标合同

权威发布流程固定为：

```text
TypedAudienceSpec
→ 同一 Snapshot 的角色集合、关系、观察条件和知识边界
→ TypedAudienceResolver
→ fail-closed 验证
→ recipientActorIds
→ recipientUserIds / recipientRoleIds 映射
→ Publication Outbox
→ EventDelivery / Narrative
```

## 6.3 迁移原则

- `affectedActorIds` 在 B0 新代码中只允许作为已验证解析结果的兼容镜像，不允许作为输入；
- `RELATION_PARTICIPANTS` 只解析真实关系的参与者；
- PRIVATE 未被观察时不通知潜在目标；
- PRIVATE NPC 允许作为合法接收者；
- Observable Trace 只透露迹象；
- Cross-player Impact 必须有另一 Actor 的真实来源与目标持久变化；
- Personal、Cross-player、World 三类结果不能共享同一个伪造 effect/source。

---

## 7. 文档要求 → 已有实现 → 缺口 → 复用方式矩阵

| B0 要求 | 当前已有实现 | 关键缺口 | 复用/迁移方式 | 阶段 |
|---|---|---|---|---|
| RoomRuleset 与 Feature Flag 冻结 | engineVersion、策略版本、现有 config/flags | 缺 B0 结构化 ruleset hash 与房间内冻结 | C1 增加世界无关合同；房间创建时持久化版本与 flags | C1 |
| SettlementWindow | `ActionWindow`、`ActorTurn` | 缺 ALL_READY_OR_DEADLINE、唯一活动窗口、统一 Window 状态机 | 扩展/映射现有 ActionWindow，不新建第二套窗口服务 | C3 |
| ActionContract | Maneuver Draft/Compiled 合同、PlayerActionIntent | 缺 B0 OBSERVE/INFLUENCE/ACT/HOLD 与 Window 绑定 | 建立 B0 合同并写 Adapter，复用现有编译器与守卫 | C1/C3 |
| SettlementSnapshot | Templates `SettlementSnapshot`、Workspace Snapshot | 缺 room/run/window/sequence/ruleset hash 的不可变绑定 | 扩展通用合同；冻结事务捕获一次并保存 hash | C1/C2/C3 |
| SettlementBatch | ResolutionWorkflow/Checkpoint、OpenNovel settleSingle | 缺唯一 Batch、inputHash、resolutionHash、Commit Manifest | 用现有 workflow/outbox 作执行骨架；新增唯一 Batch 边界 | C1/C2 |
| 单行动 Batch | settleSingle、Maneuver commit、Solo settle | 目前均有直接写世界路径 | 所有单行动先包装为 `settleBatch([intent])` | C2 |
| 原子 Commit | WindowResolution transaction、StoryEventCursor | 缺 Batch Commit 墓碑与 one-window one-sequence CAS | 重构 WindowResolution 成唯一 Commit Coordinator | C2 |
| 多 Intent 关系图 | Templates 可见性/授权规则、世界能力规则 | 缺稳定关系候选、冲突组和合并 WorldDelta | 在纯 Templates Runtime Contract 中实现 | C4 |
| 输入排列不变 | 部分纯函数与稳定 ID | 无属性测试、部分代码仍依赖遍历/请求顺序 | 稳定排序 + canonical hash + property-based 测试 | C4 |
| Typed Audience | visibility、Role Projection、EventDelivery | affectedActorIds 与直接 audience IDs 旁路 | 新 Resolver 产生唯一 recipient 集合，再写 Outbox | C5 |
| 结构化结果先发布 | EventDelivery、Maneuver Projection、Echo | 缺 B0 统一结果分类和 Causal Explanation | Public/Actor/Cross/Trace/Knowledge 分类型发布 | C5 |
| Narrative 异步 | StoryTaskOutbox、OpenNovel Runtime job/lease | 仍有立即叙事链和输入边界差异 | Commit 后建立角色化 Narrative Job，不阻塞下一 Window | C6 |
| 真实 `/game` | game-bootstrap、Continuous Story V2、Maneuver Controller | 缺 B0 Window/Ready/Countdown/Result UI | 在现有页面最小扩展，不改 Header，不建平行页 | C7 |
| 恢复与诊断 | Outbox lease、ResolutionCheckpoint、metrics | 缺 Batch/Snapshot/Audience 全链路诊断与只读重放 | C8 增加只读诊断、重发与房间级开关 | C8 |
| Credits 幂等 | 现有 Credit Consumption 与 idempotency | 未绑定 B0 Batch Commit 成功 | 费用确认绑定 Commit Manifest；失败房间可返还 | C8 |
| 真实三角色 6 Window | 现有 E2E 与 `/game` 测试基础 | 无 B0 完整房间验收 | 真实 PostgreSQL/API/Web/三隔离会话执行 | C9 |

---

## 8. 初始 B0 Ruleset v1 合同落点

C0 不提交尚未验证的运行时代码，但冻结 C1 的唯一合同落点，避免后续建立平行类型。

### 8.1 建议文件落点

```text
packages/shared/src/continuous-strategy/b0-settlement.schemas.ts
packages/shared/src/continuous-strategy/b0-settlement.validators.ts
packages/templates/src/runtime-contract/b0-settlement.ts
packages/templates/tests/b0-settlement.contract.test.ts
apps/api/src/b0-settlement/
```

命名可以根据仓库现有导出约定微调，但必须满足：

- DTO、Schema、错误码位于 `@ai-story/shared`；
- 纯关系图、Hard Constraints、WorldDelta Merge、Audience 规则位于 `@ai-story/templates`；
- Prisma/Nest/事务/Outbox 位于 `apps/api`；
- OpenNovel Runtime 只消费已提交结果，不拥有第二套 Settlement；
- Web 不持有规则真源。

### 8.2 初始 RoomRuleset v1

```ts
export interface B0RoomRulesetV1 {
  schemaVersion: "b0-room-ruleset-v1";
  rulesetVersion: string;
  settlementMode: "WINDOWED" | "IMMEDIATE";
  totalWindows: number;
  windowDurationSeconds: number;
  maxHumanPlayers: number;
  maxPrimaryIntentsPerActor: 1;
  readyPolicy: "ALL_READY_OR_DEADLINE";
  missingIntentPolicy: "LAST_CONFIRMED_OR_HOLD";
  supportedRelations: readonly ["SUPPORTS", "CONFLICTS", "INDEPENDENT"];
  reactionDepth: 0;
  playerAuthoredDelayedEffects: "DISABLED" | "NEXT_WINDOW_ONLY";
  structuredCommitmentsEnabled: false;
  allowMidGameJoin: false;
  allowRoleTransfer: false;
  allowHumanToAiTransfer: false;
  aiFillEnabled: true;
  structuredResultRequired: true;
  narrativeFailurePolicy: "CONTINUE_WITH_STRUCTURED_RESULT";
  featureFlags: {
    windowedSettlementEnabled: boolean;
    structuredActionPreviewEnabled: boolean;
    typedAudienceV2Enabled: boolean;
    structuredResultEnabled: boolean;
    narrativeAsyncEnabled: boolean;
    reactionWindowEnabled: false;
    structuredCommitmentEnabled: false;
  };
}
```

### 8.3 C1 验证要求

- 未知顶层字段拒绝；
- 未知枚举拒绝；
- `reactionDepth !== 0` 拒绝；
- `maxPrimaryIntentsPerActor !== 1` 拒绝；
- WINDOWED 下必须启用 structured result；
- 房间创建后规则对象不可变；
- Hash 对键顺序不敏感；
- 通用合同不得出现故事专用词；
- Solo `IMMEDIATE` 与 Multiplayer `WINDOWED` 使用同一结构。

---

## 9. C0 当前真实测试基线

## 9.1 可核对的 GitHub Actions 基线

已检索到与起始候选相关的 `Causal MVP` Workflow Run。该 Run 的 checkout 是 PR merge ref，而不是候选分支精确 SHA，因此它只能作为当前工程基线，不是 B0 候选验收证据。

### 通过的前置命令

| 命令 | 结果 | 说明 |
|---|---:|---|
| `pnpm install --frozen-lockfile` | PASS | 8 个 workspace，lockfile 无漂移，安装 1075 个包 |
| `pnpm db:generate` | PASS | Prisma Client 6.19.3 生成成功 |
| `pnpm --filter @apps/api typecheck` | PASS | `tsc --noEmit` 成功 |
| `pnpm --filter @apps/web typecheck` | PASS | Web 与 Maneuver 文件 `node --check` 成功 |
| `pnpm --filter @apps/api test:continuous-strategy` | PASS | ActionWindow、ActionCommand、Resolution、投影隐私、V2、Outbox 等通过 |

### 当前已知回归失败

`pnpm test:causal` 在 API 的 Solo Story Engine 套件失败：

```text
tests:   220
pass:    209
fail:    11
skip:    0
todo:    0
exit:    1
```

失败集中在：

```text
apps/api/src/solo-story-engine/__tests__/part-one-runtime-integration.spec.ts
```

主要类型：

- Narrator 输入断言与当前 wording 不一致；
- `PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING`；
- Story budget 边界；
- Actor roster / committed event rendering 断言。

由于 `test:causal` 先在 API 失败，后续 `test:causal:web` 未执行。C0 不修改这些测试，也不把该基线写成全绿。

## 9.2 C0 后续基线规则

每个 B0 阶段必须同时报告：

1. 本阶段新增/聚焦测试；
2. 与本阶段相关的旧回归；
3. 起始基线中已有且未被本阶段引入的失败；
4. 精确 `testedCodeSha`；
5. 总数、PASS、FAIL、SKIP/TODO、退出码和日志路径。

C1 起不得使用上述 PR merge-run 结果替代新 SHA 的实际测试。

---

## 10. C0 代码审计范围与未宣称范围

### 10.1 已审阅的关键落点

- 根目录 `AGENTS.md`、`README.md`、`package.json`、`pnpm-workspace.yaml`；
- `apps/api/src/continuous-strategy/action-window.service.ts`；
- `apps/api/src/continuous-strategy/action-command.service.ts`；
- `apps/api/src/continuous-strategy/window-resolution.service.ts`；
- `apps/api/src/continuous-strategy/event-delivery.service.ts`；
- `apps/api/src/maneuver-v1/**` 的 service、store、read/write、core；
- `apps/api/src/openovel-adapter/openovel-shared.service.ts`；
- `apps/api/src/solo-story-engine/solo-story-engine.service.ts`；
- `apps/openovel-runtime/src/multiplayer-runtime.ts`；
- `packages/templates/src/runtime-contract/types.ts`；
- `packages/templates/src/runtime-contract/settlement.ts`；
- `packages/templates/src/runtime-contract/projection.ts`；
- `prisma/schema.prisma`；
- `apps/web/public/game-bootstrap.js` 与现有 Maneuver V1 页面模块；
- 当前分支相对主线的 24 个提交与文件差异；
- 当前可访问的 GitHub Actions 工程日志。

### 10.2 C0 不做的声明

本审计列出的是已确认的生产主链和高风险旁路，不声称已通过静态工具证明仓库中绝对不存在任何其他写入点。C2 必须增加自动化源代码门和数据库 readback，才能将“不存在未知生产旁路”升级为可执行不变量。

---

## 11. C0 完成判定

C0 只有在以下内容进入远程分支后才完成：

- 本 B0 完整需求文档原样冻结；
- 本架构审计文档；
- 基线 SHA、需求文档 SHA 与分支归属清晰；
- 世界写入旁路清单；
- Narrative 与 legacy audience 旁路清单；
- 文档要求—已有实现—缺口—复用方式矩阵；
- 当前真实测试基线，包含已知失败；
- 初始 B0 Ruleset v1 合同落点；
- C1 进入条件和非目标冻结。

C0 完成不代表：

- B0 合同已经实现；
- 任何旁路已经关闭；
- 当前测试全绿；
- `/game` 已支持同步结算；
- 可以合并 `main`。

---

## 12. C1 唯一下一步

C1 只实现公共合同、Schema 与 Feature Flag：

- `RoomRuleset`；
- `SettlementWindow`；
- `ActionContract`；
- `SettlementSnapshot`；
- `SettlementBatch`；
- `IntentRelation`；
- `SettlementResolution`；
- `CausalEdge`；
- `TypedAudienceSpec`；
- 状态机枚举与 B0 错误码；
- 房间 Ruleset/Feature Flag 冻结合同；
- unknown fields fail-closed；
- 中性第二世界合同测试。

C1 不实现数据库事务、Window Coordinator、多 Intent 裁决、Audience 发布、Runtime 或 Web。
