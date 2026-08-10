#!/usr/bin/env bash
set -euo pipefail

BRANCH_NAME="codex/chatgpt-pro-dynamic-kernel-lite"
BASE_PRODUCT_SHA="321a9aa03ce33201a59da63350e385b885023d77"
EVIDENCE_ROOT="/tmp/settled-reaction-contract-delivery-v2"
mkdir -p "${EVIDENCE_ROOT}/logs"

test "${GITHUB_REF_NAME}" = "${BRANCH_NAME}"
git status --short | tee "${EVIDENCE_ROOT}/logs/00-status-before.log"
pnpm install --frozen-lockfile 2>&1 | tee "${EVIDENCE_ROOT}/logs/01-install.log"

bash .github/repair/prepare-verified-requirement-dependency.sh
python .github/repair/requirement-dependency-due-override.py
python .github/repair/requirement-dependency-due-test-fix.py
python .github/repair/run-settled-reaction-contract-v2.py
python .github/repair/settled-reaction-authoring-fix.py
python .github/repair/run-settled-reaction-product-fix-v4.py
python .github/repair/settled-reaction-final-wire-v5.py
python .github/repair/settled-reaction-final-wire-v6.py
python .github/repair/settled-reaction-final-wire-v7.py

SANGTIAN_SKIP_SOURCE_WRITES=1 \
SANGTIAN_AUTHORING_OUTPUT_ROOT="${RUNNER_TEMP}/sangtian-authoring-output" \
SANGTIAN_RUNTIME_PACKAGE_PATH="${GITHUB_WORKSPACE}/packages/templates/config/sangtian/story-package/part-one-runtime.json" \
  node scripts/story-decomposition/compile-sangtian-part-one-authoring.mjs \
  2>&1 | tee "${EVIDENCE_ROOT}/logs/02-compile-package.log"

git diff --check
git diff --name-status -- packages apps scripts \
  | tee "${EVIDENCE_ROOT}/product-files-before-commit.txt"
test -s "${EVIDENCE_ROOT}/product-files-before-commit.txt"
test -f packages/templates/src/story-package/requirement-dependency.ts
test -f packages/templates/src/story-package/settled-reaction-contract.ts
grep -q 'PartOneSettledReactionContract' \
  packages/templates/src/story-package/part-one-runtime-types.ts
grep -q 'PartOneUnboundActionNarrativeSource' \
  packages/templates/src/story-package/part-one-runtime-types.ts

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add packages apps scripts

mapfile -t temporary_paths < <(
  git diff --name-only "${BASE_PRODUCT_SHA}..HEAD" -- .github \
    | grep -E '(^\.github/repair/|^\.github/bootstrap/|^\.github/workflows/(requirement-dependency|settled-reaction|dynamic-kernel|source-export|dependency-export|acceptance-source-export))' \
    || true
)
for path in "${temporary_paths[@]}"; do
  git rm -f --ignore-unmatch "$path"
done

git diff --cached --check
git commit -m "feat(kernel-lite): freeze settled reactions before next decisions"
git rev-parse HEAD > "${EVIDENCE_ROOT}/tested-sha.txt"
git rev-parse HEAD^{tree} > "${EVIDENCE_ROOT}/tested-tree.txt"
git diff --name-status "${BASE_PRODUCT_SHA}..HEAD" -- packages apps scripts \
  | tee "${EVIDENCE_ROOT}/product-files.txt"
test -s "${EVIDENCE_ROOT}/product-files.txt"
git diff --name-status "${BASE_PRODUCT_SHA}..HEAD" -- .github \
  | tee "${EVIDENCE_ROOT}/github-files.txt"
if grep -E '(^|[[:space:]])\.github/(repair|bootstrap)/|requirement-dependency-|settled-reaction|dynamic-kernel-' \
  "${EVIDENCE_ROOT}/github-files.txt"; then
  echo "TEMPORARY_DELIVERY_SCAFFOLD_REMAINS" >&2
  exit 1
fi
test "$(git rev-parse HEAD^{tree})" != "$(git rev-parse ${BASE_PRODUCT_SHA}^{tree})"

results="${EVIDENCE_ROOT}/results.tsv"
: > "$results"
failed=0
run_gate() {
  local label="$1"; shift
  local log="${EVIDENCE_ROOT}/logs/${label}.log"
  set +e
  "$@" 2>&1 | tee "$log"
  local code=${PIPESTATUS[0]}
  set -e
  printf '%s\t%s\t%s\n' "$label" "$code" "$log" >> "$results"
  if [ "$code" -ne 0 ]; then failed=1; fi
}

run_gate 03-story-v4 pnpm test:story:v4
run_gate 04-templates-typecheck pnpm --filter @ai-story/templates typecheck
run_gate 05-templates-runtime-contract pnpm --filter @ai-story/templates test:runtime-contract
run_gate 06-templates-story-package pnpm --filter @ai-story/templates test:story-package
run_gate 07-templates-build pnpm --filter @ai-story/templates build
run_gate 08-openovel-typecheck pnpm --filter @apps/openovel-runtime typecheck
run_gate 09-openovel-test pnpm --filter @apps/openovel-runtime test
run_gate 10-openovel-build pnpm --filter @apps/openovel-runtime build
run_gate 11-prisma-generate pnpm db:generate
run_gate 12-api-solo pnpm --filter @apps/api test:solo-story-engine
run_gate 13-api-legacy-sangtian pnpm --filter @apps/api test:solo-story-engine:legacy-sangtian
run_gate 14-branch-persistence pnpm test:story:branch-persistence
run_gate 15-story-options pnpm test:story:options
run_gate 16-story-convergence pnpm test:story:convergence

python - <<'PY'
import os, re, sys
from pathlib import Path
root = Path("/tmp/settled-reaction-contract-delivery-v2")
tap_required = {
  "03-story-v4",
  "05-templates-runtime-contract",
  "06-templates-story-package",
  "09-openovel-test",
  "12-api-solo",
  "13-api-legacy-sangtian",
}
failed = False
for line in (root / "results.tsv").read_text().splitlines():
  label, code, log = line.split("\t", 2)
  text = Path(log).read_text(errors="replace")
  matches = re.findall(r"^# tests (\d+)$", text, re.M)
  if label in tap_required and (not matches or int(matches[-1]) <= 0):
    print(f"NON_ZERO_TEST_COUNT_MISSING:{label}", file=sys.stderr)
    failed = True
  if int(code) != 0:
    failed = True
(root / "status.txt").write_text("fail\n" if failed else "pass\n")
if failed:
  raise SystemExit(1)
PY

test "$(cat "${EVIDENCE_ROOT}/status.txt")" = pass
tested_sha="$(cat "${EVIDENCE_ROOT}/tested-sha.txt")"
test "$(git rev-parse HEAD)" = "$tested_sha"
git push origin HEAD:"${BRANCH_NAME}"
git fetch origin "${BRANCH_NAME}"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/${BRANCH_NAME})"
git rev-parse HEAD > "${EVIDENCE_ROOT}/final-sha.txt"
git rev-parse HEAD^{tree} > "${EVIDENCE_ROOT}/final-tree.txt"

python - <<'PY'
import json, os, re
from pathlib import Path
root = Path("/tmp/settled-reaction-contract-delivery-v2")
patterns = {
  "tests": re.compile(r"^# tests (\d+)$", re.M),
  "pass": re.compile(r"^# pass (\d+)$", re.M),
  "fail": re.compile(r"^# fail (\d+)$", re.M),
  "skip": re.compile(r"^# skipped (\d+)$", re.M),
  "todo": re.compile(r"^# todo (\d+)$", re.M),
}
commands = []
for line in (root / "results.tsv").read_text().splitlines():
  label, code, log = line.split("\t", 2)
  text = Path(log).read_text(errors="replace")
  row = {
    "label": label,
    "workingDirectory": os.environ.get("GITHUB_WORKSPACE"),
    "testedSha": (root / "tested-sha.txt").read_text().strip(),
    "exitCode": int(code),
    "logPath": log,
  }
  for key, pattern in patterns.items():
    found = pattern.findall(text)
    row[key] = int(found[-1]) if found else None
  commands.append(row)
summary = {
  "status": "pass",
  "baseProductSha": "321a9aa03ce33201a59da63350e385b885023d77",
  "testedSha": (root / "tested-sha.txt").read_text().strip(),
  "testedTree": (root / "tested-tree.txt").read_text().strip(),
  "finalRemoteSha": (root / "final-sha.txt").read_text().strip(),
  "finalRemoteTree": (root / "final-tree.txt").read_text().strip(),
  "commands": commands,
  "supabaseFormal": "NOT_RUN",
  "deepSeek": "NOT_RUN",
}
(root / "summary.json").write_text(
  json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
)
PY
