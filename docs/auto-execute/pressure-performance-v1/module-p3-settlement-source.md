# P3.1 候选模块卡：Settlement source preparation 快路径

- 当前状态：实现与定向正确性验证完成；真实业务 fixture 通过，SQL metrics 日志缺失。
- 单一责任：复用 HUMAN+AI+Beat 批量事务刚提交并校验的 SETTLING state、Working projection、chapter descriptor 和 sealed settlement input，消除随后 `resume()` 对 W4 与 Working 的重复读取。
- 非责任：不跳过 durable close fence，不把进程内对象直接当作跨事务权威，不修改 Settlement 规则、World CAS、Narrative/Outbox、Feed、HTTP Schema、玩家页面、Prisma Schema 或 migration。
- 当前证据：P2.1 后 Settlement 约 4,742 ms；`driveSettlement()` 会重新读取 orchestrator state、descriptor 和 Working projection，随后 durable source preparation 又读取 runtime、route、world、lineage、orchestrator 和 Working ledger。
- 安全边界：第一步只能跳过 `resume()` 中已经由 batch transaction 返回且 hash 校验通过的重复 W4/Working 读取；source preparation 的 durable fence 仍保留。若要进一步减少 source preparation SQL，必须另立模块，把所需 authority receipt 由 batch transaction 明确返回并由下一事务 CAS 验证。
- 实际结构收益：定向计数测试证明快路不再重复读取 N1 orchestrator state、N1 descriptor 与 Working projection；其中明确属于数据库热路径的是 state 与 Working projection。durable source preparation 仍完整执行。
- 最小测试：convergence 19/19、orchestrator 11/11、API typecheck 通过；完整 authority 调用快路 1 次、普通 `resume` 0 次，authority 缺失的既有用例继续调用 durable `resume`。
- 真实证据：fixture `pc_1786620186639_1b57b13d2d07db95` 为 `PASS_CLEANED`，run `solo_ed71709c442576bb3072cd755d143eb4` 完成 N1→N2；API metrics 输出句柄失效，因此不补写 P3 SQL 数字且不重跑。
- 回滚：移除可选 resume authority 参数并恢复现有 `resume(route, nowMs)`；无数据迁移或不可逆状态。
