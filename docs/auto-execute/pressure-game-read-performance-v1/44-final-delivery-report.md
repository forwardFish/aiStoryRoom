# Pressure GET `/game` SQL7-style final delivery report

Date: 2026-08-15

## Result

- Architecture: `PASS`
- Functional equivalence: `PASS`
- Real database access reduction: `ACCESS_REDUCTION_PASS`
- FAST GET target: `FAST_GET_PERF_PASS`
- Real N1 submit and N2 readback: `PASS`
- Whole decision-submit-to-N2 latency SLO: `NOT_MEASURED` (functional transition was verified, but this runner does not isolate that latency)
- Fixture cleanup: `PASS`

## Comparable real GET result

| Metric | REPLAY comparison sample | FAST warm p50 | FAST warm p95 |
|---|---:|---:|---:|
| Application SQL | 31 | 2 | 2 |
| Protocol roundtrips | 61 | 2 | 2 |
| Transaction attempts | 8 | 0 | 0 |
| Server wall time | 5,947 ms | 204 ms | 217 ms |
| Client wall time | not sampled as a warm distribution | 378.949 ms | 390.758 ms |

Application SQL decreased by 93.5%, protocol roundtrips by 96.7%, and read transactions by 100% for the comparable GET path.

## Functional evidence

- REPLAY, SHADOW, and FAST public projections were deeply equal and canonical-JSON equal.
- SHADOW reported `MATCH`.
- Projection hash, viewer seat, route hash, chapter runtime, working revision, narrative source, capabilities, resources, tokens, decision options, and Feed audience all matched.
- A real N1 decision was submitted through FAST.
- Readback reached N2 with a new runtime and decision point.
- One cold and ten warm FAST samples were collected; no performance sample was silently discarded.

## ChatGPT Pro collaboration

Principal normal Chat conversations and independently checked artifacts include:

- M1/M2 continuing conversation: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7db677-d748-83ea-b90f-e8eeb62c2f55`
- M3/I1: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f10de-5724-83e8-bd46-e28431ca4add`
- M4C: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f4b92-0a44-83e8-8db5-b61eac43da9a`
- M5B: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f54af-4b20-83e8-9608-d1011822408d`
- M5C: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f519e-0340-83ee-9f96-734aed1711eb`
- M4D1: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f6961-4fe0-83ee-8161-7d16ed0f39a6`
- M4D2: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f6d26-8034-83ee-8d1b-04a4d970345a`

Artifact hashes and per-module acceptance are recorded in documents 08, 13, 17, 18, 25, 27, 28, 31, 33, 35, 37, and 40 in this directory. ChatGPT Pro self-reports were not treated as acceptance.

## Unchanged scope

- No player-visible page or route.
- No public HTTP response contract.
- No Prisma schema or migration.
- No authored story/content package or release artifact.
- No deployment, production configuration change, `main` merge, or `release` change.

## Rollback

Set `PRESSURE_GAME_READ_MODE=REPLAY` to return reads to the legacy path. Reverting the dedicated branch commit removes the snapshot/selector/observation implementation and acceptance runner.
