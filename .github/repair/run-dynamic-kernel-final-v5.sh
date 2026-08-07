#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp/dynamic-kernel-final-repair-v5}"
mkdir -p "${EVIDENCE_ROOT}/logs"

tr -d '[:space:]' < .github/repair/dynamic-kernel-followup.patch.gz.b64 \
  | base64 --decode | gzip --decompress > "${RUNNER_TEMP}/followup.patch"
test "$(sha256sum "${RUNNER_TEMP}/followup.patch" | cut -d' ' -f1)" = \
  "cf21f3aaabd702ef8d3914d95e32443ff89ec9cd1d40ca6af11556f5b138cd07"
git apply --check "${RUNNER_TEMP}/followup.patch"
git apply "${RUNNER_TEMP}/followup.patch"
python .github/repair/apply-dynamic-kernel-final-repair.py
python .github/repair/apply-dynamic-kernel-context-balance.py
python .github/repair/apply-dynamic-kernel-continuity-repair.py
python .github/repair/apply-dynamic-kernel-sequence-compat-repair.py
git diff --check
git diff --stat | tee "${EVIDENCE_ROOT}/logs/00-diff.log"

pnpm install --frozen-lockfile 2>&1 \
  | tee "${EVIDENCE_ROOT}/logs/01-install.log"

results="${EVIDENCE_ROOT}/results.tsv"
: > "${results}"
failed=0
run_gate() {
  local label="$1"
  shift
  local log="${EVIDENCE_ROOT}/logs/${label}.log"
  set +e
  "$@" 2>&1 | tee "${log}"
  local code=${PIPESTATUS[0]}
  set -e
  printf '%s\t%s\t%s\n' "${label}" "${code}" "${log}" >> "${results}"
  if [ "${code}" -ne 0 ]; then failed=1; fi
}

run_gate 02-templates-typecheck pnpm --filter @ai-story/templates typecheck
run_gate 03-templates-runtime-contract pnpm --filter @ai-story/templates test:runtime-contract
run_gate 04-templates-story-package pnpm --filter @ai-story/templates test:story-package
run_gate 05-templates-build pnpm --filter @ai-story/templates build
run_gate 06-openovel-typecheck pnpm --filter @apps/openovel-runtime typecheck
run_gate 07-openovel-test pnpm --filter @apps/openovel-runtime test
run_gate 08-openovel-build pnpm --filter @apps/openovel-runtime build
run_gate 09-prisma-generate pnpm db:generate
run_gate 10-api-solo pnpm --filter @apps/api test:solo-story-engine
run_gate 11-api-legacy-sangtian pnpm --filter @apps/api test:solo-story-engine:legacy-sangtian
run_gate 12-branch-persistence pnpm test:story:branch-persistence
run_gate 13-story-options pnpm test:story:options
run_gate 14-story-convergence pnpm test:story:convergence
run_gate 15-story-v4 pnpm test:story:v4

if [ "${failed}" -eq 0 ]; then
  printf 'pass\n' > "${EVIDENCE_ROOT}/status.txt"
else
  printf 'fail\n' > "${EVIDENCE_ROOT}/status.txt"
fi
