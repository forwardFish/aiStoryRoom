# I1 最新 main 兼容移植独立验收

日期：2026-08-15

## 结论

`I1_CODE_ACCEPTED / BASELINE_CONTENT_GATE_OPEN`。

I1 的代码范围、准确基线补丁、最新 turn presentation 权威链保留、类型检查和非内容包依赖的聚焦行为均通过独立复核。正式 Pressure Story Source 的内容清单在未接 I1 的最新 `main` 上也会触发同一 `CONTENT_INVENTORY_HASH_MISMATCH`，因此该门是继承的基线阻塞，不归因于 I1，也没有在本性能任务中修改内容包绕过。

这不是整体功能、SHADOW、数据库访问或性能 PASS。

## Pro 交付

- 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f10de-5724-83e8-bd46-e28431ca4add`
- ZIP：`Pressure_GET_game_I1_M1_M3_port_29b3b0ad_I1_CANDIDATE.zip`
- size：86,051 bytes
- SHA-256：`068EFDDB7E781DEBF7E91EFE28866C5E7B7666D52203BD4154BB73294B7111FA`
- 精确目标基线：`main@29b3b0ad7e5201f3592748c87a0ba78126669347`
- 交付状态：`I1_CANDIDATE`

ZIP 只包含：

- `changed-files/` 下 5 个批准路径；
- `changes.patch`；
- `manifest.json`；
- `report.md`。

未发现 `.git`、`node_modules`、`.env*`、连接串或真实凭据。秘密扫描命中均为业务 token/fence、测试拒绝词或字段名。

## 机械完整性

- ZIP size/hash：与 Pro 声明一致；
- `changes.patch` SHA-256：`6721A34A89301B0B6ECDBF88CB25CFC9021B4A4EE5E859BD1708A2D3457ACCC4`；
- 精确 `29b3b0ad` 干净 worktree：`git apply --check` PASS；
- `git diff --check` PASS；
- 5/5 `changed-files` 原始 SHA-256 与 manifest 一致；
- Windows worktree 产生 CRLF 表面字节差异，但 `git hash-object --path` 的 5/5 normalized blob SHA-1 与 manifest 完全一致；没有语义漂移。

## 独立代码审查

准确生产变化只有：

1. `game-projection.service.ts`
   - `projectFromResolvedSources()` 接受既有 SQL7 动态 resolved sources 或 M1 的窄 `GameReadP0ResolvedSourcesV1`；
   - 携带 `chapterSource` 时严格要求 `chapterId === "P0"`；
   - N1–N7 仍要求并调用最新 `chapters.projectCurrent()`；
   - 两条路径最终只进入现有 `projectResolvedSources()`；
   - `PressureTurnPresentationServiceV1`、`turnPresentations`、统一 story/decision turn 与 canonical seat 链未被覆盖。
2. `index.ts`
   - 保留 `turn-authority-draft` export；
   - 只新增 `game-read-snapshot` export。
3. 两个 M1 文件保持已验收 blob；新增一个兼容 projector spec。

未发现第二 Projector、第二 capability/hash/sanitize/feed 规则，也未修改 HTTP、ProductRoot、Prisma、schema/migration、Settlement、Provider、Prompt、内容包或 `apps/web/**`。

独立 review：0 个 I1 生产代码问题。

## 测试证据

### 精确 29b3b0ad + I1

一次运行四个任务书聚焦 spec：

- tests：62
- pass：48
- fail：14

通过项包括 M1 decoder、旧 resolved-source 与 snapshot 的 P0/N1–N7/六席/模式/Feed/资源/token/hash 字节等价、P0 guard、非 P0 绕过拒绝、唯一 Projector 源码检查等。

14 个失败全部为同一根因：

```text
CONTENT_INVENTORY_HASH_MISMATCH
inventory.json#/files/finale/seat-verdict-scenes.md
expected=A40CE2F1F5E0043043195E74B218FA115DA9775AED51C7548EF95C3E088CF35F
actual=555C8079E1F84E8377934592FE08FDB44746F23E22009249EE631E72B9BB24ED
```

失败发生在 `loadPressureSpinePackage()`，早于 I1 Projector 比较。

附加门：

- `pnpm --filter @apps/api typecheck`：PASS
- `git diff --check`：PASS

### 未接 I1 的最新 main 对照

在 `origin/main@a98ef29c43545ebef985176e952fc756b33bcce1` 的隔离树，最小运行既有 `decision-presentation.spec.ts` 的首个用例，得到完全相同的 expected/actual hash 和相同错误路径。因此失败可归属到当前仓库内容包 inventory，而非 I1。

### 最新 a98ef29c + I1 + 已验收 M2/M4A

- I1 补丁目标目录在 `29b3b0ad..a98ef29c` 无漂移；
- 已存在的 M1 两个 blob 与 I1 manifest 一致；
- 其余 I1 三个路径机械应用成功；
- API typecheck：PASS；
- `git diff --check`：PASS；
- 受 I1 影响的 service + projector specs：28 PASS，6 个席位子测试及其父 suite 因同一基线内容 hash 门失败；无新增失败类型。

## 开放项

- 内容包 inventory 不在本性能任务批准范围；当前不修改；
- M4B、M5A/M5B 尚未完成；
- SHADOW、FAST、真实 Supabase 与玩家流程未执行；
- 专用分支尚未提交、推送。
