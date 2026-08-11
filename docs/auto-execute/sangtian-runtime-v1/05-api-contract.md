# API/合同冻结点

- Preview 零副作用，返回服务端编译的候选、合法性、玩家可见成本和签名 token。
- Confirm 以服务端 canonical body/fingerprint、当前 actor/control epoch、version、deadline 和幂等键校验；客户端不得提交 effect/statePatch/conflict priority。
- Game projection 最少包含：当前 phase/node/seat、viewer-safe knowledge、`actionSurface.suggestedInputs[2..3]`、`latestActionFeedback`、AI/NPC 可见状态、Finale（若完成）。
- Narrative request 包含派生 `sceneBrief`；response 必须返回 `coveredBeatIds`，通过 beat coverage 与 source reference guard，失败使用 authored fallback。
- D2/D3/D4 共享类型只由一个合同模块导出；前端不得复制枚举。

具体字段以 v1.1.0 Runtime Contracts JSON 为准；本文件不另建第二合同。
