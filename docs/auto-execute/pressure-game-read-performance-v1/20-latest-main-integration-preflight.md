# 最新 main 一次性集成预检

记录时间：2026-08-15 00:08（Asia/Shanghai）

预检基线：`origin/main@a98ef29c43545ebef985176e952fc756b33bcce1`。

## 机械补丁检查

在干净 detached worktree 上只执行补丁适用性检查：

| 模块 | 结果 | 说明 |
|---|---|---|
| M2 | PASS | Reader、新 spec、persistence export 可直接应用；落地时仍需保留 Prisma 6.19 一行测试修正。 |
| M4A | PASS | 两个新增 selector 文件可直接应用。 |
| M1 | PARTIAL | 两个 snapshot 新文件无路径冲突；`game-projection/index.ts` 因 main 已新增统一 turn 导出而不能机械应用。 |
| M3 r2 | CONFLICT | `game-projection.service.ts` 因 main 的 `PressureTurnPresentationServiceV1` / `turnPresentations` 演进不能机械应用。 |

## 结论

- I1 兼容移植是必要模块，不是重复工作：必须保留 main 的统一 turn 投影链，同时引入 M1/M3 快照 Projector。
- M2/M4A 不需要另起 Pro 重写，最终可在最新 main 上机械落地并执行组合回归。
- M4B 的冻结基线工件即使通过，也只能作为接线实现输入；最新 main 已改变 ProductRoot/production rooms composition，最终必须做最小兼容移植后再验收。
- 当前预检没有修改专用开发分支，也没有运行性能测试或声称功能等价。
