# OpenNovel 四按钮 R2-4：隔离本地真实验收说明

> 本文件不是 PASS 证明。它只定义本地 Codex 对远程精确 SHA 的执行方式。只有实际命令退出码为 0，且各证据目录中的 `report.json.verdict` 为 `PASS`，对应门才算通过。

## 1. 固定范围

- 仓库：`forwardFish/aiStoryRoom`
- 分支：`feat/mvp-four-maneuver-actions`
- 不使用 GitHub Actions runner；
- 不新增临时 workflow、Base64 源码分片或 CI 传输脚手架；
- 不修改、推送或合并 `main` / `release`；
- 不创建 PR，不部署，不操作线上用户数据。

开始前记录：

```bash
git fetch origin
git switch feat/mvp-four-maneuver-actions
git pull --ff-only origin feat/mvp-four-maneuver-actions
git rev-parse HEAD
git status --short
```

验收报告中的 `commitSha` 必须等于上述远程精确 SHA。

## 2. 工程门

在仓库根目录依次执行：

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @ai-story/shared build
pnpm --filter @apps/api typecheck
pnpm --filter @apps/api test:openovel
pnpm --filter @apps/web exec node --test \
  tests/openovel-maneuver-client.test.mjs \
  tests/openovel-maneuver-confirm-rejection.test.mjs
pnpm --filter @apps/openovel-runtime typecheck
pnpm --filter @apps/openovel-runtime test
pnpm --filter @apps/openovel-runtime build
pnpm --filter @apps/api build
pnpm --filter @apps/web typecheck
pnpm --filter @apps/web build
```

必须记录每条命令的：

```text
total / pass / fail / skip / todo；
退出码；
开始和结束时间；
原始日志路径。
```

不能用旧日志或其他 SHA 的结果替代。

## 3. 三套验收必须使用三个全新 Run

避免每日额度、已用类型和筹码状态互相污染：

```text
Run A：真实浏览器四按钮闭环；
Run B：真实 PostgreSQL Preview/Confirm 原子与并发；
Run C：需要时用于额外人工复核，不与 A/B 共用。
```

所有 Run 必须从真实页面创建：

```text
/role-select?story=sangtian&start=new
→ /game?runId=solo_ovl_...
```

禁止手工伪造 `stateJson` 代替真实新游戏。

## 4. 真实浏览器验收

### 前置条件

启动隔离 PostgreSQL、OpenNovel Runtime、API 和 Web。API 必须连接该 PostgreSQL；Web 必须代理到该 API。准备一个隔离测试账号的有效 Session Cookie。

环境变量：

```bash
export DATABASE_URL='postgresql://.../isolated_r2_4?...'
export OPENOVEL_R2_4_WEB_BASE='http://127.0.0.1:<web-port>'
export OPENOVEL_R2_4_API_BASE='http://127.0.0.1:<api-port>/api'
export OPENOVEL_R2_4_SESSION_COOKIE='many_worlds_session=<token>'
export OPENOVEL_R2_4_COMMIT_SHA="$(git rev-parse HEAD)"
export OPENOVEL_R2_4_EVIDENCE_ROOT='artifacts/openovel-maneuver-r2-4-browser'
# Windows 可显式设置：
# set CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe
```

执行：

```bash
node scripts/acceptance/openovel-maneuver-r2-4-browser.mjs
```

脚本必须实际完成：

```text
真实 role-select 创建新 Run；
进入真实 /game；
打开工作台不提交；
人物交谈 Preview；
Preview 前后 PostgreSQL 零变化；
取消 Preview；
原文本保留并重新编辑；
重新 Preview 并 Confirm；
派遣调查 Preview/Confirm；
主线继续推进到可用筹码场景；
使用筹码 Preview/Confirm；
刷新后筹码仍消失；
自拟谋划 Preview/Confirm；
四类谋划均未推进主线 worldSequence；
之后主线决策仍可成功提交。
```

证据目录至少包含：

```text
01-role-select.png/json ... 10-main-story-still-open.png/json；
network.json；
console.json；
report.json。
```

通过条件：

```text
report.json.verdict === "PASS"；
previewRequestCount >= 5；
confirmRequestCount === 4；
没有旧 /game/maneuvers 直接提交；
没有失败网络请求；
没有浏览器 error/exception；
最终 PostgreSQL 恰好 4 条 openovel_maneuver_result。
```

## 5. 真实 PostgreSQL 原子与并发验收

使用与浏览器不同的全新 Run B。该 Run 必须刚进入首个可决策场景，并且 `investigate` 与 `custom` 均可用。

环境变量：

```bash
export DATABASE_URL='postgresql://.../isolated_r2_4?...'
export OPENOVEL_R2_4_API_BASE='http://127.0.0.1:<api-port>/api'
export OPENOVEL_R2_4_RUN_ID='solo_ovl_...'
export OPENOVEL_R2_4_SESSION_COOKIE='many_worlds_session=<token>'
export OPENOVEL_R2_4_EVIDENCE_ROOT='artifacts/openovel-maneuver-r2-4-prisma'
```

执行：

```bash
pnpm exec tsx --tsconfig apps/api/tsconfig.json \
  scripts/acceptance/openovel-maneuver-r2-4-prisma.mts
```

脚本验证：

```text
Preview 后 StoryRun/version/stateJson、StoryEvent 和 AiTask 完全不变；
两个不同动作使用相同 revision 并发 Confirm，只有一个成功；
只增加 1 条 openovel_maneuver_result；
只增加 1 个 StoryRun version；
调查/自拟争抢不创建 AiTask；
获胜 Preview token 重试返回 replayed=true；
重试不增加事件、AiTask 或 version；
刷新投影与数据库一致；
worldSequence 不因谋划推进。
```

通过条件：

```text
artifacts/openovel-maneuver-r2-4-prisma/report.json.verdict === "PASS"。
```

## 6. 真实模型限量验收

必须使用真实 DeepSeek API Key。脚本会执行：

```text
3 次人物交谈：县令、巡抚、商人；
2 次 AI_REACTION 筹码回应；
1 次受控超时传输，用于验证 timeout 与世界包确定性 fallback。
```

受控超时传输会明确标记：

```text
countedAsRealModelCall = false
```

它不能冒充真实模型调用。前 5 次才计入真实模型调用数。

环境变量：

```bash
export DEEPSEEK_API_KEY='...'
export DEEPSEEK_BASE_URL='https://api.deepseek.com'
export DEEPSEEK_MODEL='<实际验收模型>'
export AI_CAUSAL_MAX_ATTEMPTS='1'
export AI_CAUSAL_TIMEOUT_MS='30000'
export OPENOVEL_R2_4_INPUT_USD_PER_MILLION='0.435'
export OPENOVEL_R2_4_OUTPUT_USD_PER_MILLION='0.87'
export OPENOVEL_R2_4_EVIDENCE_ROOT='artifacts/openovel-maneuver-r2-4-real-model'
```

执行：

```bash
pnpm exec tsx --tsconfig apps/api/tsconfig.json \
  scripts/acceptance/openovel-maneuver-r2-4-real-model.mts
```

脚本记录：

```text
模型；
逻辑调用数；
底层 HTTP attempts；
input/output tokens；
延迟；
按验收配置估算的成本；
原始结构化输出；
timeout fallback。
```

通过条件：

```text
report.json.verdict === "PASS"；
真实 logicalCalls === 5；
三个人物回应不完全相同；
不替玩家作决定；
不泄漏隐藏 sentinel；
不输出 statePatch/factKeys/metrics；
受控超时只产生一次 HTTP attempt，并返回世界包 fallback。
```

## 7. 最终报告口径

只有以下三份报告均为 PASS，且工程门全部退出码 0，才允许输出：

```text
R2_4_PUSHED
```

只有 R2-1—R2-4 均有当前远程精确 SHA 的真实证据，才允许输出：

```text
CANDIDATE_BRANCH_READY
```

否则必须输出：

```text
CANDIDATE_BRANCH_INCOMPLETE
```

不得把脚本存在、runner 排队、Mock、0 tests、HTTP 200、历史日志或自述当作 PASS。
