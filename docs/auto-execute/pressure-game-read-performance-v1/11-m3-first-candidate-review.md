# M3 first candidate independent review

Status: `M3_REQUEST_CHANGES / NOT_ACCEPTED`

## Candidate identity

- Pro chat: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f10de-5724-83e8-bd46-e28431ca4add`
- ZIP: `Pressure_GET_game_M3_unique_projector_b6f512_M1accepted.zip`
- Size: `30,281 bytes`
- SHA-256: `6A43CA675D3435652ABD0C25E2CD9D35F18E8206C04C31738CB122F0EE823EE8`
- Base: `b6f512442f7e67d6c6d0dcaa2e6449bdd849de44` plus accepted M1 files

## Mechanical and focused checks

- ZIP CRC: PASS.
- Manifest changed-file hashes: PASS.
- Patch hash and `git apply --check`: PASS.
- Changed-file set: exactly the allowed service and focused spec.
- Secret/forbidden-path scan: PASS.
- Delivered files and landed files: normalized-LF byte-equivalent.
- M1 + existing projector + M3 focused tests: `42/42 PASS`.
- `pnpm --filter @apps/api typecheck`: PASS.
- `git diff --check`: PASS.

These green checks do not establish M3 acceptance because the independent source review found a runtime contract gap.

## Blocking finding

`PressureChapterGameProjectionService.projectFromResolvedSources()` selects the P0 shortcut only by checking whether `chapterSource` exists. It does not fail closed when a dynamic N1-N7 input carries `chapterSource`. A malformed or future caller could therefore bypass the required dynamic `chapters.projectCurrent()` call.

Required correction:

1. Lock the `chapterSource` branch to P0 at runtime.
2. Prove that non-P0 input carrying `chapterSource` is rejected.
3. Keep N1-N7 on `projectCurrent()` exactly once.

## Evidence gaps returned to Pro

- Extend the actual dynamic equivalence matrix from the sampled N1/N2/N7 set to N1-N7.
- Record and assert Feed request-side `feedCursor` and `feedLimit` forwarding, not only returned `nextCursor`.

The correction request was sent to the original M3 Pro normal Chat. The first candidate remains locally landed only for review and will be replaced mechanically by the corrected artifact before acceptance.
