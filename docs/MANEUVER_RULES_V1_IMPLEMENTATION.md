# MANEUVER_RULES_V1 实现说明

## 基线与范围

- 需求基线：`Our Many Worlds 四类谋划、行动预演卡与调查证据系统 v1.0`
- 源码基线：`main@4afd7d8952380876910a1a16d4b0d37bd25098e0`
- 真实页面：现有 `/game`，未增加平行游戏页或测试专用页面
- 首个可执行世界：《桑田诏》
- 同时提供中性双世界规则测试，通用合同不依赖桑田诏专有词

## 已实现能力

### 四类主动谋划

右侧永久入口保持为：

```text
人物交谈｜派遣调查｜筹码布局｜自拟谋划
```

每个场景由服务端权威投影两次主动谋划机会；人物交谈和派遣调查各最多主动发起一次。应变由剧情事件触发，不作为第五个永久入口；“暂不应变”不消耗主动谋划，也不写入世界行动。

### 两阶段行动提交

```text
草稿 → 服务端编译与守卫 → 剧情化预演卡 → 玩家确认 → 原子提交
```

预演使用 AES-256-GCM 加密签名令牌绑定：Run、Turn、角色、控制权 epoch、世界 revision、谋划窗口版本、上下文摘要、草稿摘要、服务端编译动作与预演展示。预演阶段不扣次数、不改世界、不创建行动；确认阶段重新校验所有版本并 fail closed。

### 调查与证据手牌

```text
权威事实 → 角色可见痕迹 → 有限调查路线 → 私人证据手牌
```

调查只能从当前角色可见的真实痕迹开始。路线明确：可能查到、不能证明、成本、返回时机和可能留下的调查痕迹。证据区分 `LEAD / CORROBORATION / PROOF`，每张牌保存支持命题、不能证明、来源组、真实性、所有者和可见范围。

### 筹码布局

规则筹码支持：

```text
ACTIVE：现在打出
SET：按有限条件伏置
ATTACH：附加到交谈、调查或自拟谋划
REACTION：只在合法应变窗口使用
```

牌面时机、目标、效果、消耗、冷却与反制边界由服务端规则定义。伏置牌触发幂等，过期后释放；被触发的原行动会进入 `RESOLVED/TRIGGERED`。

### 自拟谋划

自然语言可以自由表达，但只能编译成一个主要效果。系统会：

- 将获得信息的表达重路由到派遣调查；
- 将要求人物回应的表达重路由到人物交谈；
- 将主要依赖规则牌的表达重路由到筹码布局；
- 将多项独立行为返回 `SPLIT_REQUIRED`；
- 拒绝替其他玩家决定、宣告结果、读取未知内心、越权或绕过成本；
- 保证简短和冗长表达不会因字数获得不同规则强度。

### 多人视角与时间线

- 私人证据仅投影给所有者、明确共享对象或公共受众；
- 定向交谈只送达目标角色；
- 秘密调查只发布其规则允许的可观察痕迹；
- 已提交动作和后续结果通过 `sourceActionId` / source references 关联；
- Continuous Story V2 侧谋划与主线世界序号使用 CAS，存在主线预留世界序号时拒绝侧谋划，避免双写冲突。

## 主要代码位置

```text
packages/templates/src/maneuver-v1/**
apps/api/src/maneuver-v1/**
apps/api/src/mvp-causal-runtime.ts
apps/api/src/continuous-story-v2/continuous-story-v2.service.ts
apps/api/src/rooms.controller.ts
apps/api/src/rooms.service.ts
packages/shared/src/continuous-strategy/story-v2.schemas.ts
apps/web/public/maneuver-v1.js
apps/web/public/maneuver-v1.css
apps/web/public/app.js
apps/web/public/api-story-storage.js
apps/web/public/continuous-story-v2-legacy-storage.js
```

## Feature flag

```text
MANEUVER_RULES_V1_ENABLED=true|false
MANEUVER_RULES_V1_WORLD_ALLOWLIST=sangtian
MANEUVER_PREVIEW_SECRET=<production 32+ character secret>
```

默认只为允许列表中的新/兼容 Run 暴露 capability。Web 只根据服务端 `capabilities.maneuverRulesV1.enabled` 选择新流程，不根据 worldId 写规则分支。

## 测试命令

```bash
pnpm test:maneuver:v1:contracts
pnpm test:maneuver:v1:api
pnpm test:maneuver:v1:web
pnpm test:maneuver:v1
```

无依赖下载条件下可以用仓库已有 TypeScript/Node 运行时执行对应的单文件测试；完整 CI 应在正常 `pnpm install --frozen-lockfile` 后再执行全量 workspace typecheck、API、Web、Story V4 和 OpenNovel 回归。

## 当前兼容边界

- 当前真实多人 `/game` 的 Continuous Story V2 路径和 `/api/v4/story-runs` causal MVP 路径已经接入。
- OpenNovel shared runtime 的世界权威合同仍保持原有边界；本次没有让浏览器直接调用 OpenNovel internal API，也没有建立第二套世界真源。
- 未增加 Prisma migration：实现复用现有 `PlayerAction`、`RoleAsset`、`RoleAssetMutation`、`CanonFact`、`NarrativeEntry`、`StoryEvent` 与 Turn revision。预演使用加密、短时、服务端签名令牌，不持久化副作用状态。
