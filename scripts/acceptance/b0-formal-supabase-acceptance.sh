#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-}"
shift || true

required() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 1
  fi
}

ensure_evidence_root() {
  required B0_EVIDENCE_ROOT
  mkdir -p "$B0_EVIDENCE_ROOT/logs"
}

prepare_database() {
  ensure_evidence_root
  required B0_FORMAL_DATABASE_URL
  required B0_DATABASE_SECRET_NAME
  required B0_ACCEPTANCE_ENVIRONMENT
  node scripts/acceptance/b0-formal-db-admin.mjs prepare
}

verify_database() {
  ensure_evidence_root
  required DATABASE_URL
  required B0_ACCEPTANCE_SCHEMA
  node scripts/acceptance/b0-formal-db-admin.mjs verify
}

prepare_provider() {
  ensure_evidence_root
  required B0_FORMAL_PROVIDER_API_KEY
  required B0_PROVIDER_SECRET_NAME
  required B0_ACCEPTANCE_ENVIRONMENT
  node scripts/acceptance/b0-formal-provider-probe.mjs
}

cleanup() {
  ensure_evidence_root
  required DATABASE_URL
  required B0_ACCEPTANCE_SCHEMA
  node scripts/acceptance/b0-formal-db-admin.mjs cleanup
}

redact() {
  ensure_evidence_root
  python3 - <<'PY'
import os
import re
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
secret_values = [
    os.environ.get("B0_FORMAL_DATABASE_URL", ""),
    os.environ.get("DATABASE_URL", ""),
    os.environ.get("B0_FORMAL_PROVIDER_API_KEY", ""),
    os.environ.get("OPENOVEL_API_KEY", ""),
]
text_suffixes = {".json", ".jsonl", ".log", ".md", ".txt"}
for path in root.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in text_suffixes:
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    for value in sorted((value for value in secret_values if value), key=len, reverse=True):
        text = text.replace(value, "[REDACTED]")
    text = re.sub(r"postgres(?:ql)?://[^\s\"']+", "[REDACTED_DATABASE_URL]", text, flags=re.I)
    text = re.sub(r"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", text, flags=re.I)
    text = re.sub(r"many_worlds_session=[^;\s]+", "many_worlds_session=[REDACTED]", text, flags=re.I)
    path.write_text(text, encoding="utf-8")

patterns = [
    re.compile(r"postgres(?:ql)?://", re.I),
    re.compile(r"Bearer\s+(?!\[REDACTED\])", re.I),
    re.compile(r"many_worlds_session=(?!\[REDACTED\])", re.I),
    re.compile(r"(?:api[_-]?key|password|cookie|token)\s*[:=]\s*[\"']?(?!\[REDACTED\]|false|true|null)[A-Za-z0-9._~+/=-]{12,}", re.I),
]
failures = []
scanned = 0
for path in root.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in text_suffixes:
        continue
    scanned += 1
    text = path.read_text(encoding="utf-8", errors="replace")
    for pattern in patterns:
        if pattern.search(text):
            failures.append({"path": str(path).replace("\\", "/"), "pattern": pattern.pattern})

scan_path = root / "redaction-scan.json"
scan_path.write_text(__import__("json").dumps({
    "schemaVersion": 1,
    "status": "FAIL" if failures else "PASS",
    "scannedTextFileCount": scanned,
    "failureCount": len(failures),
    "failures": failures,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
if failures:
    raise SystemExit("Formal acceptance evidence redaction scan failed")
PY
}

finalize() {
  ensure_evidence_root
  required GITHUB_SHA
  required GITHUB_RUN_ID
  required GITHUB_RUN_ATTEMPT
  required B0_ACCEPTANCE_ENVIRONMENT

  python3 - <<'PY'
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
result = json.loads((root / "acceptance-result.json").read_text(encoding="utf-8"))
database = json.loads((root / "database-provenance.json").read_text(encoding="utf-8"))
migration = json.loads((root / "database-migration-readback.json").read_text(encoding="utf-8"))
provider = json.loads((root / "provider-provenance.json").read_text(encoding="utf-8"))
cleanup = json.loads((root / "schema-cleanup.json").read_text(encoding="utf-8"))
redaction = json.loads((root / "redaction-scan.json").read_text(encoding="utf-8"))

required_phases = {
    "window-1-embedded-real-narrative",
    "idempotent-settlement-publication-outbox-replay",
    "window-2-narrative-failure-does-not-rollback-and-retry",
    "window-3-pause-current-completes-next-does-not-open-resume",
    "window-4-deadline-unconfirmed-human-becomes-hold",
    "switch-to-independent-worker",
    "window-5-independent-worker",
    "window-6-worker-crash-lease-expiry-recovery-and-ending",
    "single-human-ai-action-contract-and-safe-abort",
    "browser-dom-network-privacy-and-readback",
}
phases = {str(entry.get("name")): entry for entry in result.get("phases", [])}
missing = sorted(required_phases - phases.keys())
failed = sorted(name for name in required_phases if phases.get(name, {}).get("status") != "PASS")

checks = {
    "acceptanceResultPass": result.get("status") == "PASS",
    "formalAcceptanceTier": result.get("environment", {}).get("acceptanceTier") == "formal-c8",
    "formalEnvironmentMatches": result.get("environment", {}).get("acceptanceEnvironment") == os.environ["B0_ACCEPTANCE_ENVIRONMENT"],
    "databaseFormalProvenance": database.get("provenance") == "supabase-cloud-nonproduction-random-schema",
    "databasePass": database.get("status") == "PASS",
    "supabaseCloudUsed": database.get("supabaseCloudUsed") is True,
    "selfHostedContainerNotUsed": database.get("selfHostedContainerUsed") is False,
    "migrationPass": migration.get("status") == "PASS" and int(migration.get("migratedTableCount", 0)) > 0,
    "publicSchemaUnchanged": cleanup.get("publicSchemaUnchanged") is True,
    "publicSchemaApplicationWritesFalse": cleanup.get("publicSchemaApplicationWrites") is False,
    "randomSchemaDropped": cleanup.get("randomSchemaDropped") is True,
    "providerFormalProvenance": provider.get("provenance") == "deepseek-api-real",
    "providerProbeReady": provider.get("status") == "READY" and provider.get("httpStatus") == 200,
    "providerNotDeterministic": provider.get("deterministicProvider") is False,
    "providerFallbackForbidden": provider.get("fallbackAllowed") is False,
    "redactionPass": redaction.get("status") == "PASS",
    "allRequiredPhasesPresent": not missing,
    "allRequiredPhasesPass": not failed,
}
if not all(checks.values()):
    raise SystemExit("Formal C8 finalization failed: " + json.dumps({"checks": checks, "missingPhases": missing, "failedPhases": failed}, ensure_ascii=False))

c8 = root.parent.parent / "c8"
c8.mkdir(parents=True, exist_ok=True)
checkpoint = {
    "schemaVersion": 1,
    "checkpoint": "B0_C8_REAL_NONPRODUCTION_SUPABASE_VALIDATED",
    "status": "PASS",
    "testedCodeSha": os.environ["GITHUB_SHA"],
    "workflowRunId": os.environ["GITHUB_RUN_ID"],
    "workflowRunAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
    "acceptanceEnvironment": os.environ["B0_ACCEPTANCE_ENVIRONMENT"],
    "database": {
        "provenance": database["provenance"],
        "databaseSecretName": database["databaseSecretName"],
        "managedHostSha256": database["managedHostSha256"],
        "connectionMode": database["connectionMode"],
        "randomSchema": database["randomSchema"],
        "randomSchemaSha256": database["randomSchemaSha256"],
        "migratedTableCount": migration["migratedTableCount"],
        "randomSchemaDropped": cleanup["randomSchemaDropped"],
        "publicSchemaUnchanged": cleanup["publicSchemaUnchanged"],
        "publicSchemaApplicationWrites": cleanup["publicSchemaApplicationWrites"],
    },
    "provider": {
        "provenance": provider["provenance"],
        "providerSecretName": provider["providerSecretName"],
        "requestedModel": provider["requestedModel"],
        "responseModel": provider["responseModel"],
        "modelIdentityDigest": provider["modelIdentityDigest"],
        "requestIdPresent": provider["requestIdPresent"],
        "requestIdSha256": provider["requestIdSha256"],
        "deterministicProvider": provider["deterministicProvider"],
        "fallbackAllowed": provider["fallbackAllowed"],
    },
    "validated": sorted(required_phases),
    "checks": checks,
    "evidenceRoot": str(root).replace("\\", "/"),
}
(c8 / "checkpoint.json").write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

files = []
for path in sorted(p for p in root.rglob("*") if p.is_file() and p.name != "artifact-catalog.json"):
    data = path.read_bytes()
    files.append({
        "path": str(path).replace("\\", "/"),
        "sizeBytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    })
catalog = {
    "schemaVersion": 1,
    "status": "PASS",
    "acceptanceTier": "formal-c8",
    "testedCodeSha": os.environ["GITHUB_SHA"],
    "workflowRunId": os.environ["GITHUB_RUN_ID"],
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "files": files,
}
(root / "artifact-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

blocker() {
  required B0_BLOCKER_ROOT
  required GITHUB_SHA
  required GITHUB_RUN_ID
  required GITHUB_RUN_ATTEMPT
  required B0_PROBE_ENVIRONMENTS
  required B0_DATABASE_ALIASES_CHECKED
  required B0_PROVIDER_ALIASES_CHECKED
  mkdir -p "$B0_BLOCKER_ROOT"
  python3 - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["B0_BLOCKER_ROOT"])
payload = {
    "schemaVersion": 1,
    "status": "BLOCKED_FAIL_CLOSED",
    "classification": "EXTERNAL_NONPRODUCTION_CREDENTIALS_UNAVAILABLE",
    "testedCodeSha": os.environ["GITHUB_SHA"],
    "workflowRunId": os.environ["GITHUB_RUN_ID"],
    "workflowRunAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "nonProductionEnvironmentsProbed": os.environ["B0_PROBE_ENVIRONMENTS"].split("|"),
    "databaseSecretAliasesChecked": os.environ["B0_DATABASE_ALIASES_CHECKED"].split("|"),
    "providerSecretAliasesChecked": os.environ["B0_PROVIDER_ALIASES_CHECKED"].split("|"),
    "completeCredentialPairFound": False,
    "formalC8Executed": False,
    "containerResultAcceptedAsFormalC8": False,
    "productionPublicSchemaAccessed": False,
    "requiredExternalAction": "Configure one approved non-production Supabase PostgreSQL URL and one DeepSeek API key in a probed non-production GitHub Environment using an accepted alias.",
}
(root / "formal-c8-credential-blocker.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

self_check() {
  bash -n "$0"
  node --check scripts/acceptance/b0-formal-db-admin.mjs
  node --check scripts/acceptance/b0-formal-provider-probe.mjs
  echo B0_FORMAL_SUPABASE_ACCEPTANCE_SELF_CHECK_OK
}

case "$command_name" in
  prepare-database) prepare_database ;;
  verify-database) verify_database ;;
  prepare-provider) prepare_provider ;;
  cleanup) cleanup ;;
  redact) redact ;;
  finalize) finalize ;;
  blocker) blocker ;;
  self-check) self_check ;;
  *)
    echo "Usage: $0 {prepare-database|verify-database|prepare-provider|cleanup|redact|finalize|blocker|self-check}" >&2
    exit 2
    ;;
esac
