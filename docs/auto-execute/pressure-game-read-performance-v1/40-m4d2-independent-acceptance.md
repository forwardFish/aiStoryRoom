# M4D2 independent acceptance

Date: 2026-08-15

## Delivery

- ChatGPT Pro normal Chat: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f6d26-8034-83ee-8d1b-04a4d970345a`
- ZIP: `Pressure_GET_game_M4D2_FAST_boundary_a98ef29c.zip`
- Bytes: `22,374`
- SHA-256: `A6EE29F10B46DE482E64581415FCB794CE094030390642F47766EFF12B29AA26`
- Baseline: `main@a98ef29c43545ebef985176e952fc756b33bcce1`

## Scope review

Only the approved paths were present in `changed-files/` and `changes.patch`:

- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.ts`
- `apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts`

No player page, schema, migration, public route, ProductRoot, selector, snapshot reader, access adapter, observer, release asset or deployment file was included.

`git apply --check changes.patch` passed before application. The mechanically applied local text matches both delivered files line-for-line. The branch retains repository CRLF and omits two delivery-only trailing empty lines, so byte hashes differ from the LF ZIP files; executable source text is otherwise identical.

## Independent behavior evidence

- focused command initially used the root tsconfig and failed before executing tests because decorators were disabled; this was classified as a harness command error, not a source failure;
- the single failed target was rerun with `TSX_TSCONFIG_PATH=apps/api/tsconfig.json`;
- focused facade spec: `25/25 PASS`;
- complete installed-workspace `pnpm --filter @apps/api typecheck`: `PASS`;
- `git diff --check`: `PASS`.

The focused test proves:

- FAST performs `access -> selected-game-read`, with zero facade route/stored-route pre-reads;
- access denial stops before snapshot/route reads and preserves the public 403;
- snapshot errors preserve public identity/mapping and do not fall back;
- REPLAY and SHADOW retain dispatch plus stored-route validation;
- GET observer wraps once; non-GET behavior remains on the previous full route context.

## Verdict

`M4D2_CODE_ACCEPTED`

This is not yet `ACCESS_REDUCTION_PASS`, `SQL7_PASS` or `PERF_PASS`. Real Supabase three-mode equivalence, SQL/roundtrip/transaction counts and cold/warm latency remain for the unified acceptance run.
