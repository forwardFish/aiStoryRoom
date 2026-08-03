# C-2 root correction addendum

停止上一轮继续执行。刚才独立读取 C-1 源码后，确认“保留 C-1 Web 与测试”也是错误假设。请以此补充为 C-2 的完整约束，修完底层后再重新测试。

## 已复现的 Web/测试根缺陷

1. `apps/web/public/openovel-role-client.js` 与对应测试/三角色脚本的实际源码仍包含乱码，例如 `鎴戠殑瑙掕壊`、`涓栫晫浜嬩欢`、`姝ｅ湪...`。这不是终端显示问题：UTF-8 解码后的源文件本身即为 mojibake。必须用正确中文 UTF-8 重写，并增加针对 `\uFFFD` 和典型 mojibake 字符序列的源码/DOM 负向测试。

2. `scripts/e2e/openovel-mp-offline.test.mjs` 只是内存 Map 模拟幂等和断线，不调用产品代码、数据库、HTTP 路由或 outbox。它不能作为 concurrency/fault PASS。

3. `scripts/e2e/openovel-mp-three-role.mjs` 自建一个返回静态 fixture 的 HTTP server，再直接调用 `renderOpenNovelRoleChrome()`；没有启动真实 Web/API，没有登录产品账号，没有执行 `/game` 客户端动作，也没有 World/Outbox/Interaction/Control 状态变化。它不能作为三角色 E2E PASS。

4. `scripts/e2e/openovel-mp-browser.py` 自建一个只有 login/action/projection 的静态 HTML 页面；它不加载 `apps/web/public/index.html`、`game-bootstrap.js`、Continuous Story V2 客户端或产品 API，所以三 Browser Context 只是测试假页面。

5. `scripts/acceptance/openovel-mp-contract.mjs` 只在源码字符串中搜索字段名，不能证明 API 合同、隐私、impact 生命周期或路由行为。

## 必须替换的测试策略

- unit：可以使用 JSDOM，但必须导入真实产品模块并驱动真实 DOM 行为；乱码、Observer 稳定、Options 为空自由输入、interaction 回复、SSE/reconnect/control 状态都要断言。
- contract：调用真实共享 validator 和 API service/projection helper；至少构造第三角色不可见的 asset/commitment/outbox/provider/prompt/statePatch 数据并序列化负测。
- concurrency/fault：调用实际 impact receipt/order/idempotency helper 或 API service 事务路径；覆盖 runtime 成功后 DB 失败、重复任务、lease 丢失、seq2 impact/seq3 own result 乱序。禁止内存 Map 自我实现被测算法。
- three-role：使用隔离本地数据库和真实 API/Web 服务，三个独立测试账号/角色；通过产品登录/claim/action/interaction/control HTTP/UI 链累计 12 个权威世界事件，最终从数据库/安全 API 读回。
- browser：启动仓库真实 `apps/web/src/server.mjs` 与 API；Python Playwright `channel=chrome` 创建三个 Browser Context，走真实 `/game?runId=...` 页面和 UI 控件。禁止内嵌静态 HTML、token 注入、page.fetch 切身份、单页伪装。
- 环境若不足，脚本必须明确 FAIL/NOT RUN，不能用 fixture 代替真实门禁后标 PASS。

## 三次止损规则

同一失败最多验证三次，每次必须有不同假设与新证据；第三次仍失败就停止并回到底层状态机、顺序/幂等、投影合同或上下文编译修改，不得继续重跑或调 Prompt。

请从当前已确认的底层 API 缺陷继续，但同时替换上述伪门禁和乱码 Web。只有真实产品链的测试证据才可报告 PASS。现在重新实施 C-2。
