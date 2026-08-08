#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_ROOT="${EVIDENCE_ROOT:-/tmp/dynamic-kernel-requirement-dependency-round3-final}"
mkdir -p "${EVIDENCE_ROOT}/logs"

tr -d '[:space:]' \
  < .github/repair/dynamic-kernel-requirement-dependency.py.gz.b64 \
  | base64 --decode | gzip --decompress \
  > "${RUNNER_TEMP}/dynamic-kernel-requirement-dependency.py"
test "$(sha256sum "${RUNNER_TEMP}/dynamic-kernel-requirement-dependency.py" | cut -d' ' -f1)" = \
  "a1bc1185636751d4aa4056a1a3dc45d0ffd46085b56cd4f82e5a98378c8eb884"
python "${RUNNER_TEMP}/dynamic-kernel-requirement-dependency.py" \
  2>&1 | tee "${EVIDENCE_ROOT}/logs/01-apply-base.log"
python .github/repair/dynamic-kernel-requirement-dependency-round1-format.py
python .github/repair/dynamic-kernel-dependency-runtime-semantics.py
python .github/repair/dynamic-kernel-dependency-predecessor-kernels.py
python .github/repair/dynamic-kernel-authored-transition-surface.py
python .github/repair/dynamic-kernel-context-projection.py
python .github/repair/dynamic-kernel-context-budget.py

SANGTIAN_SKIP_SOURCE_WRITES=1 \
SANGTIAN_AUTHORING_OUTPUT_ROOT="${RUNNER_TEMP}/sangtian-authoring-output" \
SANGTIAN_RUNTIME_PACKAGE_PATH="${GITHUB_WORKSPACE}/packages/templates/config/sangtian/story-package/part-one-runtime.json" \
  node scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs \
  2>&1 | tee "${EVIDENCE_ROOT}/logs/02-compile-package.log"

git diff --check
git diff --stat | tee "${EVIDENCE_ROOT}/logs/03-diff-stat.log"
git diff --binary > "${EVIDENCE_ROOT}/product.patch"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add \
  packages/templates/src/story-package/requirement-dependency.ts \
  packages/templates/src/story-package/part-one-runtime-types.ts \
  packages/templates/src/story-package/index.ts \
  packages/templates/src/story-package/part-one-runtime-loader.ts \
  packages/templates/src/story-package/dynamic-kernel-lite-runtime.ts \
  packages/templates/src/story-package/part-one-runtime-engine.ts \
  packages/templates/src/runtime-contract/kernel-selector-lite.ts \
  packages/templates/tests/requirement-dependency.test.ts \
  packages/templates/tests/part-one-dynamic-kernel-lite.test.ts \
  packages/templates/package.json \
  packages/templates/authoring/sangtian/requirements/part-01.requirements.json \
  packages/templates/config/sangtian/story-package/part-one-runtime.json \
  scripts/story-decomposition/lib/requirement-dependency.mjs \
  scripts/story-decomposition/build-sangtian-part-one-authoring.mjs \
  scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs \
  apps/api/src/solo-story-engine/types.ts \
  apps/api/src/solo-story-engine/context-compiler.ts

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
git commit -m "feat(kernel-lite): add validated requirement dependency routing"
git rev-parse HEAD > "${EVIDENCE_ROOT}/tested-sha.txt"
git show --stat --oneline HEAD > "${EVIDENCE_ROOT}/tested-commit.txt"
git status --short > "${EVIDENCE_ROOT}/pre-test-status.txt"
test ! -s "${EVIDENCE_ROOT}/pre-test-status.txt"

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

run_gate 04-story-v4 pnpm test:story:v4
run_gate 05-templates-typecheck pnpm --filter @ai-story/templates typecheck
run_gate 06-templates-runtime-contract pnpm --filter @ai-story/templates test:runtime-contract
run_gate 07-templates-story-package pnpm --filter @ai-story/templates test:story-package
run_gate 08-templates-build pnpm --filter @ai-story/templates build
run_gate 09-openovel-typecheck pnpm --filter @apps/openovel-runtime typecheck
run_gate 10-openovel-test pnpm --filter @apps/openovel-runtime test
run_gate 11-openovel-build pnpm --filter @apps/openovel-runtime build
run_gate 12-prisma-generate pnpm db:generate
run_gate 13-api-solo pnpm --filter @apps/api test:solo-story-engine
run_gate 14-api-legacy-sangtian pnpm --filter @apps/api test:solo-story-engine:legacy-sangtian
run_gate 15-branch-persistence pnpm test:story:branch-persistence
run_gate 16-story-options pnpm test:story:options
run_gate 17-story-convergence pnpm test:story:convergence

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
results = root / "results.tsv"
if results.exists():
    for line in results.read_text().splitlines():
        label, code, log_path = line.split("\t", 2)
        path = Path(log_path)
        text = path.read_text(errors="replace") if path.exists() else ""
        row = {"label": label, "exitCode": int(code), "logPath": log_path}
        for key, pattern in patterns.items():
            values = pattern.findall(text)
            row[key] = int(values[-1]) if values else None
        rows.append(row)
summary = {
    "inputSha": os.environ["GITHUB_SHA"],
    "testedSha": (root / "tested-sha.txt").read_text().strip(),
    "status": (root / "status.txt").read_text().strip(),
    "commands": rows,
    "supabaseFormal": "NOT_RUN",
    "deepSeek": "NOT_RUN",
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
PY

exit 0
