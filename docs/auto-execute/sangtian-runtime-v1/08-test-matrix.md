# 测试矩阵摘要

权威 92 项矩阵：`C:\\Users\\linyanhui\\Downloads\\sangtian_phase2_test_matrix_v1_1_0.csv`。

| Gate | 目标 |
|---|---|
| Content/D1 | 内容包 hash、stable IDs、图、知识边界 |
| D2 unit/contract | action guard、defaults、conflict、custody/version、Frozen、replay |
| D2 integration/recovery | Prisma 原子性、outbox、checkpoint fault injection、重启恢复 |
| NAR-006 | 四节拍 coverage、source allowlist、authored fallback |
| UX-001/UI-001 | 建议/自由输入、可见后果卡和 `/game` 状态 |
| LIVE-001 | 真实 1 人 + 5 AI P0—N7/Finale，不用 mock 冒充真实模型 |
| Browser sleep flow | 输入“我先睡一下”，断言半日、压力 +1、先手旁落、急报新现场 |
| Final | lint/typecheck/tests/build/E2E/secret/diff/exact SHA |

每条证据记录命令、exit code、total/pass/fail/skip、日志路径、模型/数据库是否真实。
