#!/usr/bin/env bash
set -euo pipefail

HISTORICAL_IMPLEMENTATION_SHA="40908fd7583ea4006f328903d4b65c660670ad38"

git show \
  "${HISTORICAL_IMPLEMENTATION_SHA}:.github/repair/dynamic-kernel-requirement-dependency.py.gz.b64" \
  | tr -d '[:space:]' \
  | base64 --decode \
  | gzip --decompress \
  > "${RUNNER_TEMP}/dynamic-kernel-requirement-dependency.py"

scripts=(
  dynamic-kernel-requirement-dependency-round1-format.py
  dynamic-kernel-dependency-runtime-semantics.py
  dynamic-kernel-dependency-predecessor-kernels.py
  dynamic-kernel-authored-transition-surface.py
  dynamic-kernel-context-budget.py
)
for script in "${scripts[@]}"; do
  git show "${HISTORICAL_IMPLEMENTATION_SHA}:.github/repair/${script}" \
    > "${RUNNER_TEMP}/${script}"
done

python "${RUNNER_TEMP}/dynamic-kernel-requirement-dependency.py"
for script in "${scripts[@]}"; do
  python "${RUNNER_TEMP}/${script}"
done
