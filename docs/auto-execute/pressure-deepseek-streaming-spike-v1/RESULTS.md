# Pressure DeepSeek Streaming Spike v1

## Scope

```text
branch: codex/pressure-deepseek-streaming-spike-v1
baseline: 6f7deb711ce19423a056082261fd8345ee4c3954
model: deepseek-v4-flash
sample count: 3
status: FEASIBILITY_ONLY_NOT_P95
```

This spike did not edit or load the formal `/game` page and did not mutate the
database. It loaded the real N1 B02 public and seat authoring JSON, reused the
production turn prompt context compiler and existing final candidate validator,
then called DeepSeek with `stream:true` and JSON Output.

The three calls covered:

1. Hu Zongxian with a fixed evacuation action;
2. Zheng Bichang with an explicit inaction;
3. Shen Yishi with a complex conditional merchant action.

`actionSaveMs` was not measured because this isolated Provider spike performed
no database write. These results only compare streamed visibility with waiting
for the complete model candidate.

## Raw timings

All values are milliseconds from the start of the DeepSeek HTTP request.

| Case | Headers | First token | Scene first char | First sentence | Scene complete | Candidate complete | Existing validator |
|---|---:|---:|---:|---:|---:|---:|---|
| Hu Zongxian / fixed | 210.74 | 811.84 | 849.11 | 1,064.30 | 4,807.28 | 5,840.20 | FAIL: required previous-action ref omitted |
| Zheng Bichang / inaction | 126.82 | 898.74 | 920.37 | 1,181.81 | 4,791.16 | 6,007.42 | PASS |
| Shen Yishi / complex | 139.16 | 599.33 | 638.04 | 889.81 | 5,499.97 | 7,585.95 | FAIL: unknown fact ref returned |

Prompt size was 10,459–10,682 characters. Every request ended normally with
`finish_reason=stop`.

## Three-sample descriptive statistics

These are not p95 claims.

| Metric | Minimum | Median | Maximum |
|---|---:|---:|---:|
| Provider TTFT | 599.33 | 811.84 | 898.74 |
| First complete sentence | 889.81 | 1,064.30 | 1,181.81 |
| Scene complete | 4,791.16 | 4,807.28 | 5,499.97 |
| Full candidate complete | 5,840.20 | 6,007.42 | 7,585.95 |

Showing the first real sentence instead of waiting for the complete candidate
would have made AI-authored content visible approximately:

```text
Hu Zongxian: 4,775.90 ms earlier
Zheng Bichang: 4,825.61 ms earlier
Shen Yishi: 6,696.14 ms earlier
```

## Contract results

```text
SSE/JSON protocol complete: 3/3
sceneText streamed successfully: 3/3
existing final candidate validator: 1/3
```

The two failures were not transport failures. DeepSeek produced complete JSON
and useful role-specific scenes, but the final `usedFactRefs` contract was not
reliable enough:

- one candidate omitted the two mandatory previous-action references;
- one candidate returned a fact reference outside the authority draft allowlist.

This means the latency hypothesis is supported, but the complete production
contract is not yet proven. The current implementation must not be merged into
`main` as a player feature.

## Verdict

Evidence supports the narrow statement:

> With the current real N1 prompt size, DeepSeek V4 Flash can begin returning
> role-specific causal narrative in under 1.2 seconds after the Provider request,
> around 4.8–6.7 seconds before the complete structured candidate is available.

Evidence does not yet support:

- stable p95 under five seconds from browser click;
- three-of-three final contract validity;
- safe player-visible streaming before incremental safety rules exist;
- action-save latency, reconnect, restart, or multi-instance behavior.

## Reproduction

```powershell
$env:TSX_TSCONFIG_PATH='apps/api/tsconfig.json'
$env:PRESSURE_STREAMING_SPIKE_OUTPUT='.codex-runtime/pressure-deepseek-streaming-spike-v1.json'
node --env-file=.env.test --import tsx scripts/diagnostics/pressure-deepseek-streaming-spike.ts
```

The evidence JSON is intentionally written under ignored `.codex-runtime/` and
contains no API key or full prompt payload.
