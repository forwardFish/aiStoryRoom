#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp/dynamic-kernel-final-repair-v5}"
test -f "${EVIDENCE_ROOT}/status.txt"
test "$(tr -d '\r\n' < "${EVIDENCE_ROOT}/status.txt")" = pass

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add \
  packages/templates/src/runtime-contract/kernel-selector-lite.ts \
  packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts \
  packages/templates/src/story-package/part-one-runtime-engine.ts \
  packages/templates/tests/kernel-selector-lite.test.ts \
  apps/api/src/solo-story-engine/context-compiler.ts \
  apps/openovel-runtime/src/sangtian-decisions-base.ts \
  apps/openovel-runtime/src/sangtian-decisions.ts \
  apps/openovel-runtime/tests/sangtian-dynamic-kernel-production.spec.ts

git rm -f --ignore-unmatch \
  .github/repair/dynamic-kernel-followup.patch.gz.b64 \
  .github/repair/apply-dynamic-kernel-final-repair.py \
  .github/repair/apply-dynamic-kernel-continuity-repair.py \
  .github/repair/apply-dynamic-kernel-sequence-compat-repair.py \
  .github/repair/run-dynamic-kernel-final-v5.sh \
  .github/repair/commit-dynamic-kernel-final-v5.sh \
  .github/workflows/dynamic-kernel-apply-followup-repair.yml \
  .github/workflows/dynamic-kernel-final-deterministic-gates.yml \
  .github/workflows/dynamic-kernel-architecture-debug.yml \
  .github/workflows/dynamic-kernel-diagnostics.yml \
  .github/workflows/dynamic-kernel-final-repair.yml \
  .github/workflows/dynamic-kernel-final-repair-v2.yml \
  .github/workflows/dynamic-kernel-final-repair-v3.yml \
  .github/workflows/dynamic-kernel-final-repair-v4.yml \
  .github/workflows/dynamic-kernel-final-repair-v5.yml \
  .github/workflows/dynamic-kernel-candidate-trace.yml \
  .github/workflows/dynamic-kernel-core-repair.yml \
  .github/workflows/dynamic-kernel-lockfile-repair.yml

git diff --cached --check
git commit -m "fix(kernel-lite): preserve causal sequence and unbound narration"
git push origin HEAD:codex/chatgpt-pro-dynamic-kernel-lite
