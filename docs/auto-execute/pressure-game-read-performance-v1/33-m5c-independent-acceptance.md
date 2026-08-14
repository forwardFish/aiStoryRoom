# M5C 独立验收记录

## 模块结论

- 状态：`FOCUSED_ACCEPTANCE_PASS`
- 非生产真实 Supabase 三模式验收：`TESTS_NOT_RUN`
- 本记录只证明 M5C runner 的本地聚焦行为，不证明最终性能门通过。

## ChatGPT Pro 交付

- 对话：`https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f519e-0340-83ee-9f96-734aed1711eb`
- 文件：`Pressure_GET_game_M5C_acceptance_runner_delivery_a98ef29c.zip`
- 大小：`51,109 bytes`
- SHA-256：`1549E1ABF951E4D8130941DA0CEE103C9A0FC69F12BB86BB79BE371EA407CC97`
- 基线声明：`main@a98ef29c43545ebef985176e952fc756b33bcce1 + M5A`

## 范围核对

交付只涉及：

- `scripts/acceptance/pressure-chapter/game-read-performance-acceptance.mjs`
- `scripts/acceptance/pressure-chapter/cases/acceptance/game-read-performance-acceptance.test.mjs`
- `scripts/acceptance/pressure-chapter/fixtures/local-auth-fixture.mjs` 的三个窄导出别名

未修改运行时业务语义、数据库、迁移、HTTP 路由、玩家页面或生产配置。

## Codex 独立验收

首次聚焦运行先暴露 Node 24 + `tsx` 下 TypeScript CommonJS 包装模块不能使用静态 named import。只对 runner 做 ESM/CJS 兼容导入修正，未修改 M5A 合同或 runner 验收语义。

执行：

```text
node --import tsx --test scripts/acceptance/pressure-chapter/cases/acceptance/game-read-performance-acceptance.test.mjs
```

结果：

- tests：`18`
- pass：`18`
- fail：`0`
- duration：约 `9.79s`
- `git diff --check`：`PASS`

覆盖同一 run 的 REPLAY/SHADOW/FAST 完整等价、固定 `1 cold + 10 warm`、SHADOW mismatch、观测缺失/混合、提交与回读失败归属、无全流程自动重试、输出脱敏及 finally cleanup。

## 未完成门

- 三个隔离 API + allowlisted non-production Supabase：`TESTS_NOT_RUN`
- 真实 M5B observation log：`TESTS_NOT_RUN`
- 真实 application SQL / protocol roundtrip / transaction 数据：`TESTS_NOT_RUN`
- warm p50/p95 与最终 `PERF_PASS`：`TESTS_NOT_RUN`
