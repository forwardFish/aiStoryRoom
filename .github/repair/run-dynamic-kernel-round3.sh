#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp/dynamic-kernel-round3}"
mkdir -p "${EVIDENCE_ROOT}/logs"

python .github/repair/dynamic-kernel-round2-repair.py
python .github/repair/dynamic-kernel-round3-contract.py
git diff --check
git diff --stat | tee "${EVIDENCE_ROOT}/logs/00-repair-diff.log"
git diff --binary > "${EVIDENCE_ROOT}/repair.patch"

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

run_gate 02-story-v4 pnpm test:story:v4
if [ "${failed}" -eq 0 ]; then
  run_gate 03-templates-typecheck pnpm --filter @ai-story/templates typecheck
  run_gate 04-templates-runtime-contract pnpm --filter @ai-story/templates test:runtime-contract
  run_gate 05-templates-story-package pnpm --filter @ai-story/templates test:story-package
  run_gate 06-templates-build pnpm --filter @ai-story/templates build
  run_gate 07-openovel-typecheck pnpm --filter @apps/openovel-runtime typecheck
  run_gate 08-openovel-test pnpm --filter @apps/openovel-runtime test
  run_gate 09-openovel-build pnpm --filter @apps/openovel-runtime build
  run_gate 10-prisma-generate pnpm db:generate
  run_gate 11-api-solo pnpm --filter @apps/api test:solo-story-engine
  run_gate 12-api-legacy-sangtian pnpm --filter @apps/api test:solo-story-engine:legacy-sangtian
  run_gate 13-branch-persistence pnpm test:story:branch-persistence
  run_gate 14-story-options pnpm test:story:options
  run_gate 15-story-convergence pnpm test:story:convergence
fi

if [ "${failed}" -eq 0 ]; then
  printf 'pass\n' > "${EVIDENCE_ROOT}/status.txt"
else
  printf 'fail\n' > "${EVIDENCE_ROOT}/status.txt"
fi

python - <<'PY'
import json, os, re
from pathlib import Path
root = Path(os.environ["EVIDENCE_ROOT"])
rows = []
patterns = {
    "tests": re.compile(r"^# tests (\d+)$", re.MULTILINE),
    "pass": re.compile(r"^# pass (\d+)$", re.MULTILINE),
    "fail": re.compile(r"^# fail (\d+)$", re.MULTILINE),
    "skip": re.compile(r"^# skipped (\d+)$", re.MULTILINE),
    "todo": re.compile(r"^# todo (\d+)$", re.MULTILINE),
}
for line in (root / "results.tsv").read_text().splitlines():
    label, code, log_path = line.split("\t", 2)
    text = Path(log_path).read_text(errors="replace")
    row = {"label": label, "exitCode": int(code), "logPath": log_path}
    for key, pattern in patterns.items():
        matches = pattern.findall(text)
        row[key] = int(matches[-1]) if matches else None
    rows.append(row)
summary = {
    "inputSha": os.environ["GITHUB_SHA"],
    "status": (root / "status.txt").read_text().strip(),
    "commands": rows,
    "totals": {
        key: sum(row[key] or 0 for row in rows)
        for key in ["tests", "pass", "fail", "skip", "todo"]
    },
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
PY

if [ "$(tr -d '\r\n' < "${EVIDENCE_ROOT}/status.txt")" != pass ]; then
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add \
  packages/templates/src/runtime-contract/kernel-selector-lite.ts \
  packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts \
  packages/templates/src/story-package/dynamic-kernel-lite-settlement.ts \
  packages/templates/src/story-package/part-one-runtime-engine.ts \
  packages/templates/tests/kernel-selector-lite.test.ts \
  packages/templates/tests/part-one-dynamic-kernel-lite.test.ts \
  apps/openovel-runtime/src/sangtian-decisions-base.ts \
  apps/openovel-runtime/tests/sangtian-dynamic-kernel-production.spec.ts \
  apps/openovel-runtime/tests/openovel-first.spec.ts

mapfile -t repair_files < <(git ls-files '.github/repair/*dynamic-kernel*')
if [ "${#repair_files[@]}" -gt 0 ]; then
  git rm -f -- "${repair_files[@]}"
fi
mapfile -t workflow_files < <(git ls-files '.github/workflows/dynamic-kernel-*')
if [ "${#workflow_files[@]}" -gt 0 ]; then
  git rm -f -- "${workflow_files[@]}"
fi
git rm -f --ignore-unmatch docs/.architecture-probe-marker

git diff --cached --check
git commit -m "fix(kernel-lite): preserve causal routing and scene authority"
final_sha="$(git rev-parse HEAD)"
printf '%s\n' "${final_sha}" > "${EVIDENCE_ROOT}/final-sha.txt"
git show --stat --oneline --decorate HEAD \
  > "${EVIDENCE_ROOT}/final-commit.txt"
git status --short > "${EVIDENCE_ROOT}/post-commit-status.txt"
test ! -s "${EVIDENCE_ROOT}/post-commit-status.txt"
