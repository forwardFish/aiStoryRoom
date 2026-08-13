# P2.1 模块卡：最终 Projection 重复权威读取收敛

- 单一责任：在提交请求已经持有刚提交且校验通过的 authority 时，减少最终玩家 Projection 对 viewer/world/capability 的重复数据库读取，并让彼此独立的剩余读取并发执行。
- 非责任：不修改 Settlement、WorkingLedger、Narrative/Feed 的持久化语义、HTTP Schema、玩家页面、Prisma Schema 或 migration；不伪造缺失的 Narrative/Feed。
- 权威输入：已校验的提交 snapshot、最终 chapter/Working projection、frozen bundle 与当前用户绑定。
- 权威输出：与现有 `PressureGameProjectionV1` 完全相同的数据合同和 fail-closed 行为。
- 依赖：现有 viewer、world、narrative、capability、feed adapter 的投影规则；只复用请求内已经验证的 authority，不新增第二事实来源。
- 准确文件：
  - `apps/api/src/pressure-chapter/game-projection/contracts.ts`
  - `apps/api/src/pressure-chapter/game-projection/game-projection.service.ts`
  - `apps/api/src/pressure-chapter/game-projection/game-projection.service.spec.ts`
  - `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
- 已确认边界：committed-authority 路径在已经拥有当前 viewer control、chapter phase/decision 的情况下，Capability adapter 又读取 viewer authority 与 chapter runtime，共 3 条重复 SQL；viewer、world、narrative、feed 还可在已绑定 room/seat/chapter 后并发读取。
- 最小测试：旧读取与 committed-authority 读取深相等；跨用户/跨房间/旧 revision fail closed；Narrative 缺失仍失败；独立读取并发但错误语义不变。
- 失败所有者：Game Projection；无法证明 authority 完整时回退现有读取路径。
- 回滚：移除 committed-authority 快路径并恢复串行 adapter 读取；无数据迁移或不可逆状态。
- 性能门：先静态确认唯一重复边界；focused tests/typecheck 通过后，只运行一次与 P1.1 相同的真实场景。SQL、往返、事务和阶段耗时必须同时报告，不能只看总耗时。
- 正确性证据：Projection focused tests 12/12、API typecheck、`git diff --check` 通过；真实 fixture 为 `PASS_CLEANED`，注册、鉴权、开局、N1 Projection、提交、N2 readback 全部通过。
- 性能证据：纠正 embedded worker 污染后，SQL 102→93（-8.8%）、往返 134→123（-8.2%）、事务 13→13；最终 Projection 4,809→2,622 ms（-45.5%），端到端 19,620→16,459 ms（-16.1%），0 rollback、0 retry。
- 判定：满足项目所有者要求的“同场景成功且访问次数减少”，模块为 `ACCESS_REDUCTION_PASS`；未执行 p50/p95，不标记最终时延 SLO 通过。
