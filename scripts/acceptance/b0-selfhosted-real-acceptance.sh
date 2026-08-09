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

image_digest() {
  local image="$1"
  local ref
  ref="$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")"
  local digest="${ref#*@}"
  if [[ "$digest" != sha256:* ]]; then
    echo "Image $image has no sha256 RepoDigest" >&2
    exit 1
  fi
  printf '%s' "$digest"
}

fingerprint_public_schema() {
  required B0_DATABASE_CONTAINER
  required B0_DATABASE_PASSWORD
  docker exec -e PGPASSWORD="$B0_DATABASE_PASSWORD" "$B0_DATABASE_CONTAINER" \
    psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -At \
    -c "
      SELECT line FROM (
        SELECT 'table|' || table_schema || '|' || table_name AS line
          FROM information_schema.tables
         WHERE table_schema = 'public'
        UNION ALL
        SELECT 'column|' || table_schema || '|' || table_name || '|' || column_name || '|' || ordinal_position::text || '|' || data_type
          FROM information_schema.columns
         WHERE table_schema = 'public'
        UNION ALL
        SELECT 'view|' || table_schema || '|' || table_name
          FROM information_schema.views
         WHERE table_schema = 'public'
        UNION ALL
        SELECT 'routine|' || routine_schema || '|' || routine_name || '|' || routine_type
          FROM information_schema.routines
         WHERE routine_schema = 'public'
      ) fingerprint
      ORDER BY line;
    "
}

prepare_database() {
  ensure_evidence_root
  required B0_DATABASE_IMAGE
  required GITHUB_RUN_ID
  required GITHUB_RUN_ATTEMPT
  required GITHUB_ENV

  local schema="cs_accept_b0_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}_$(openssl rand -hex 4)"
  local password="$(openssl rand -hex 32)"
  local jwt_secret="$(openssl rand -hex 32)"
  local container="b0-supabase-postgres-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  local port=55432

  echo "::add-mask::$password"
  echo "::add-mask::$jwt_secret"

  docker pull "$B0_DATABASE_IMAGE"
  local digest id
  digest="$(image_digest "$B0_DATABASE_IMAGE")"
  id="$(docker image inspect --format '{{.Id}}' "$B0_DATABASE_IMAGE")"
  [[ "$id" == sha256:* ]]

  docker run -d \
    --name "$container" \
    -p "127.0.0.1:${port}:5432" \
    -e POSTGRES_HOST=/var/run/postgresql \
    -e PGPORT=5432 \
    -e POSTGRES_PORT=5432 \
    -e PGPASSWORD="$password" \
    -e POSTGRES_PASSWORD="$password" \
    -e PGDATABASE=postgres \
    -e POSTGRES_DB=postgres \
    -e JWT_SECRET="$jwt_secret" \
    -e JWT_EXP=3600 \
    "$B0_DATABASE_IMAGE" \
    postgres \
      -c config_file=/etc/postgresql/postgresql.conf \
      -c log_min_messages=warning >/dev/null

  local ready=false
  for _attempt in $(seq 1 90); do
    if docker exec -e PGPASSWORD="$password" "$container" \
      pg_isready -h localhost -U postgres -d postgres >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 2
  done
  if [ "$ready" != true ]; then
    docker logs --tail 200 "$container" >&2 || true
    exit 1
  fi

  docker exec -e PGPASSWORD="$password" "$container" \
    psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE SCHEMA \"$schema\";" >/dev/null

  export B0_DATABASE_CONTAINER="$container"
  export B0_DATABASE_PASSWORD="$password"
  fingerprint_public_schema > "$B0_EVIDENCE_ROOT/public-schema-before.txt"
  local public_sha public_lines server_version runtime_url
  public_sha="$(sha256sum "$B0_EVIDENCE_ROOT/public-schema-before.txt" | cut -d' ' -f1)"
  public_lines="$(wc -l < "$B0_EVIDENCE_ROOT/public-schema-before.txt" | tr -d ' ')"
  server_version="$(docker exec -e PGPASSWORD="$password" "$container" psql -h localhost -U postgres -d postgres -At -c 'SHOW server_version;')"
  runtime_url="postgresql://postgres:${password}@127.0.0.1:${port}/postgres?schema=${schema}&connection_limit=3&sslmode=disable"
  echo "::add-mask::$runtime_url"

  {
    echo "DATABASE_URL=$runtime_url"
    echo "MANY_WORLDS_DB_SCHEMA=$schema"
    echo "B0_ACCEPTANCE_SCHEMA=$schema"
    echo "B0_DATABASE_CONTAINER=$container"
    echo "B0_DATABASE_PASSWORD=$password"
    echo "B0_DATABASE_PROVENANCE=official-supabase-postgres-container"
    echo "B0_DATABASE_IMAGE_DIGEST=$digest"
    echo "B0_DATABASE_IMAGE_ID=$id"
    echo "B0_PUBLIC_SCHEMA_BEFORE_SHA=$public_sha"
    echo "B0_PUBLIC_SCHEMA_BEFORE_LINES=$public_lines"
  } >> "$GITHUB_ENV"

  B0_ACCEPTANCE_SCHEMA="$schema" \
  B0_DATABASE_IMAGE_DIGEST="$digest" \
  B0_DATABASE_IMAGE_ID="$id" \
  B0_DATABASE_SERVER_VERSION="$server_version" \
  B0_PUBLIC_SCHEMA_BEFORE_SHA="$public_sha" \
  B0_PUBLIC_SCHEMA_BEFORE_LINES="$public_lines" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
payload = {
    "schemaVersion": 1,
    "status": "READY",
    "provenance": "official-supabase-postgres-container",
    "image": os.environ["B0_DATABASE_IMAGE"],
    "imageDigest": os.environ["B0_DATABASE_IMAGE_DIGEST"],
    "imageId": os.environ["B0_DATABASE_IMAGE_ID"],
    "serverVersion": os.environ["B0_DATABASE_SERVER_VERSION"],
    "randomSchema": os.environ["B0_ACCEPTANCE_SCHEMA"],
    "publicSchemaUsed": False,
    "supabaseCloudUsed": False,
    "publicSchemaBeforeSha256": os.environ["B0_PUBLIC_SCHEMA_BEFORE_SHA"],
    "publicSchemaBeforeLineCount": int(os.environ["B0_PUBLIC_SCHEMA_BEFORE_LINES"]),
}
(root / "database-provenance.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY

  DATABASE_URL="$runtime_url" MANY_WORLDS_DB_SCHEMA="$schema" pnpm prisma migrate deploy
}

prepare_provider() {
  ensure_evidence_root
  required B0_PROVIDER_IMAGE
  required B0_PROVIDER_MODEL
  required GITHUB_RUN_ID
  required GITHUB_RUN_ATTEMPT
  required GITHUB_ENV

  local container="b0-ollama-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  local port=11434
  local api_key="ollama-$(openssl rand -hex 24)"
  echo "::add-mask::$api_key"

  docker pull "$B0_PROVIDER_IMAGE"
  local digest id
  digest="$(image_digest "$B0_PROVIDER_IMAGE")"
  id="$(docker image inspect --format '{{.Id}}' "$B0_PROVIDER_IMAGE")"
  [[ "$id" == sha256:* ]]

  docker run -d \
    --name "$container" \
    -p "127.0.0.1:${port}:11434" \
    -e OLLAMA_KEEP_ALIVE=30m \
    -e OLLAMA_NUM_PARALLEL=1 \
    -e OLLAMA_MAX_LOADED_MODELS=1 \
    -e OLLAMA_CONTEXT_LENGTH=32768 \
    "$B0_PROVIDER_IMAGE" >/dev/null

  local ready=false
  for _attempt in $(seq 1 120); do
    if curl --fail --silent --show-error "http://127.0.0.1:${port}/api/version" > /tmp/b0-ollama-version.json; then
      ready=true
      break
    fi
    sleep 2
  done
  if [ "$ready" != true ]; then
    docker logs --tail 200 "$container" >&2 || true
    exit 1
  fi

  jq -n --arg model "$B0_PROVIDER_MODEL" '{model:$model,stream:false}' > /tmp/b0-ollama-pull-request.json
  curl --fail --silent --show-error --max-time 1800 \
    -H 'content-type: application/json' \
    --data-binary @/tmp/b0-ollama-pull-request.json \
    "http://127.0.0.1:${port}/api/pull" > /tmp/b0-ollama-pull-response.json
  jq -e '.status == "success"' /tmp/b0-ollama-pull-response.json >/dev/null

  curl --fail --silent --show-error "http://127.0.0.1:${port}/api/tags" > /tmp/b0-ollama-tags.json
  local model_digest ollama_version
  model_digest="$(jq -r --arg model "$B0_PROVIDER_MODEL" '.models[] | select(.name == $model or .model == $model) | .digest' /tmp/b0-ollama-tags.json | head -1)"
  test -n "$model_digest"
  case "$model_digest" in sha256:*) ;; *) model_digest="sha256:$model_digest" ;; esac
  ollama_version="$(jq -r '.version' /tmp/b0-ollama-version.json)"
  test -n "$ollama_version"

  jq -n --arg model "$B0_PROVIDER_MODEL" '{
    model:$model,
    messages:[{role:"user",content:"Return one JSON object with a boolean field named ok set to true."}],
    temperature:0,
    max_tokens:64,
    stream:false,
    response_format:{type:"json_object"}
  }' > /tmp/b0-ollama-warmup-request.json
  curl --fail --silent --show-error --max-time 600 \
    -H "authorization: Bearer $api_key" \
    -H 'content-type: application/json' \
    --data-binary @/tmp/b0-ollama-warmup-request.json \
    "http://127.0.0.1:${port}/v1/chat/completions" > /tmp/b0-ollama-warmup-response.json
  jq -e '.choices[0].message.content | type == "string" and length > 0' /tmp/b0-ollama-warmup-response.json >/dev/null
  local warmup_text request_count_before
  warmup_text="$(jq -r '.choices[0].message.content' /tmp/b0-ollama-warmup-response.json)"
  printf '%s' "$warmup_text" | jq -e '.ok == true' >/dev/null
  request_count_before="$(docker logs "$container" 2>&1 | grep -Ec 'POST[[:space:]]+"?/v1/chat/completions' || true)"

  {
    echo "OPENOVEL_PROVIDER_BASE_URL=http://127.0.0.1:${port}/v1"
    echo "OPENOVEL_API_KEY=$api_key"
    echo "OPENOVEL_MODEL=$B0_PROVIDER_MODEL"
    echo "B0_PROVIDER_PROVENANCE=ollama-openai-compatible-local"
    echo "B0_PROVIDER_IMAGE_DIGEST=$digest"
    echo "B0_PROVIDER_IMAGE_ID=$id"
    echo "B0_PROVIDER_MODEL_DIGEST=$model_digest"
    echo "B0_PROVIDER_CONTAINER=$container"
    echo "B0_PROVIDER_REQUESTS_BEFORE=$request_count_before"
  } >> "$GITHUB_ENV"

  B0_PROVIDER_IMAGE_DIGEST="$digest" \
  B0_PROVIDER_IMAGE_ID="$id" \
  B0_PROVIDER_MODEL_DIGEST="$model_digest" \
  B0_PROVIDER_OLLAMA_VERSION="$ollama_version" \
  B0_PROVIDER_REQUESTS_BEFORE="$request_count_before" \
  python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
warmup = json.loads(Path("/tmp/b0-ollama-warmup-response.json").read_text(encoding="utf-8"))
text = str(warmup.get("choices", [{}])[0].get("message", {}).get("content", ""))
payload = {
    "schemaVersion": 1,
    "status": "READY",
    "provenance": "ollama-openai-compatible-local",
    "image": os.environ["B0_PROVIDER_IMAGE"],
    "imageDigest": os.environ["B0_PROVIDER_IMAGE_DIGEST"],
    "imageId": os.environ["B0_PROVIDER_IMAGE_ID"],
    "ollamaVersion": os.environ["B0_PROVIDER_OLLAMA_VERSION"],
    "model": os.environ["B0_PROVIDER_MODEL"],
    "modelDigest": os.environ["B0_PROVIDER_MODEL_DIGEST"],
    "transport": "OpenAI-compatible HTTP",
    "endpoint": "/v1/chat/completions",
    "localIsolatedRunner": True,
    "deterministicProvider": False,
    "fallbackAllowed": False,
    "warmup": {
        "responseModel": warmup.get("model"),
        "contentSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "contentLength": len(text),
        "finishReason": warmup.get("choices", [{}])[0].get("finish_reason"),
    },
    "successfulRequestCountBeforeProductAcceptance": int(os.environ["B0_PROVIDER_REQUESTS_BEFORE"]),
}
(root / "provider-provenance.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY
}

provider_proof() {
  ensure_evidence_root
  required B0_PROVIDER_CONTAINER
  required B0_PROVIDER_REQUESTS_BEFORE
  docker logs "$B0_PROVIDER_CONTAINER" > "$B0_EVIDENCE_ROOT/logs/ollama.log" 2>&1 || true
  local after before product_requests successful
  after="$(grep -Ec 'POST[[:space:]]+"?/v1/chat/completions' "$B0_EVIDENCE_ROOT/logs/ollama.log" || true)"
  before="$B0_PROVIDER_REQUESTS_BEFORE"
  product_requests=$((after - before))
  if [ "$product_requests" -lt 1 ]; then
    echo "No post-warmup product request reached /v1/chat/completions" >&2
    exit 1
  fi
  successful="$(grep -E 'POST[[:space:]]+"?/v1/chat/completions' "$B0_EVIDENCE_ROOT/logs/ollama.log" | grep -Ec '\|[[:space:]]*200[[:space:]]*\|' || true)"
  if [ "$successful" -lt "$after" ]; then
    echo "One or more model requests were not HTTP 200" >&2
    exit 1
  fi

  B0_PROVIDER_REQUESTS_AFTER="$after" \
  B0_PROVIDER_PRODUCT_REQUESTS="$product_requests" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
path = root / "provider-provenance.json"
payload = json.loads(path.read_text(encoding="utf-8"))
payload.update({
    "status": "PASS",
    "successfulRequestCountAfterAcceptance": int(os.environ["B0_PROVIDER_REQUESTS_AFTER"]),
    "postWarmupProductRequestCount": int(os.environ["B0_PROVIDER_PRODUCT_REQUESTS"]),
    "allObservedCompletionsHttp200": True,
})
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

cleanup() {
  ensure_evidence_root

  cleanup_containers() {
    local container
    for container in "${B0_PROVIDER_CONTAINER:-}" "${B0_DATABASE_CONTAINER:-}"; do
      if [ -n "$container" ] && docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
        docker rm -f "$container" >/dev/null || true
      fi
    done
  }
  trap cleanup_containers EXIT

  required B0_DATABASE_CONTAINER
  required B0_DATABASE_PASSWORD
  required B0_ACCEPTANCE_SCHEMA
  required B0_PUBLIC_SCHEMA_BEFORE_SHA
  required B0_PUBLIC_SCHEMA_BEFORE_LINES

  local schema="$B0_ACCEPTANCE_SCHEMA"
  if ! [[ "$schema" =~ ^cs_accept_b0_[a-zA-Z0-9_]{8,}$ ]] || [ "${schema,,}" = public ]; then
    echo "Refusing cleanup for an invalid or public schema" >&2
    exit 1
  fi

  fingerprint_public_schema > "$B0_EVIDENCE_ROOT/public-schema-after.txt"
  local after_sha after_lines
  after_sha="$(sha256sum "$B0_EVIDENCE_ROOT/public-schema-after.txt" | cut -d' ' -f1)"
  after_lines="$(wc -l < "$B0_EVIDENCE_ROOT/public-schema-after.txt" | tr -d ' ')"
  test "$after_sha" = "$B0_PUBLIC_SCHEMA_BEFORE_SHA"
  test "$after_lines" = "$B0_PUBLIC_SCHEMA_BEFORE_LINES"
  cmp "$B0_EVIDENCE_ROOT/public-schema-before.txt" "$B0_EVIDENCE_ROOT/public-schema-after.txt"

  docker exec -e PGPASSWORD="$B0_DATABASE_PASSWORD" "$B0_DATABASE_CONTAINER" \
    psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP SCHEMA \"$schema\" CASCADE;" >/dev/null
  local remaining
  remaining="$(docker exec -e PGPASSWORD="$B0_DATABASE_PASSWORD" "$B0_DATABASE_CONTAINER" \
    psql -h localhost -U postgres -d postgres -At \
    -c "SELECT count(*) FROM pg_namespace WHERE nspname = '$schema';")"
  test "$remaining" = "0"

  docker logs "$B0_DATABASE_CONTAINER" > "$B0_EVIDENCE_ROOT/logs/supabase-postgres.log" 2>&1 || true

  python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
before = (root / "public-schema-before.txt").read_bytes()
after = (root / "public-schema-after.txt").read_bytes()
payload = {
    "schemaVersion": 1,
    "status": "PASS",
    "randomSchema": os.environ["B0_ACCEPTANCE_SCHEMA"],
    "randomSchemaDropped": True,
    "publicSchemaUsed": False,
    "publicSchemaUnchanged": before == after,
    "publicSchemaBeforeSha256": hashlib.sha256(before).hexdigest(),
    "publicSchemaAfterSha256": hashlib.sha256(after).hexdigest(),
    "publicSchemaBeforeLineCount": len(before.decode("utf-8").splitlines()),
    "publicSchemaAfterLineCount": len(after.decode("utf-8").splitlines()),
}
(root / "schema-cleanup.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
database_path = root / "database-provenance.json"
database = json.loads(database_path.read_text(encoding="utf-8"))
database.update({
    "status": "PASS",
    "randomSchemaDropped": True,
    "publicSchemaUnchanged": before == after,
    "publicSchemaAfterSha256": hashlib.sha256(after).hexdigest(),
    "publicSchemaAfterLineCount": len(after.decode("utf-8").splitlines()),
})
database_path.write_text(json.dumps(database, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

finalize_engineering() {
  ensure_evidence_root
  required GITHUB_SHA
  required GITHUB_RUN_ID
  required GITHUB_RUN_ATTEMPT

  python3 - <<'PY'
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
result = json.loads((root / "acceptance-result.json").read_text(encoding="utf-8"))
database = json.loads((root / "database-provenance.json").read_text(encoding="utf-8"))
provider = json.loads((root / "provider-provenance.json").read_text(encoding="utf-8"))
cleanup = json.loads((root / "schema-cleanup.json").read_text(encoding="utf-8"))
if result.get("status") != "PASS":
    raise SystemExit("engineering acceptance result is not PASS")
if result.get("environment", {}).get("acceptanceTier") != "engineering-selfhosted":
    raise SystemExit("self-hosted acceptance result is not marked engineering-selfhosted")
if database.get("provenance") != "official-supabase-postgres-container":
    raise SystemExit("engineering database provenance is invalid")
if database.get("supabaseCloudUsed") is not False:
    raise SystemExit("engineering evidence cannot claim Supabase Cloud")
if provider.get("provenance") != "ollama-openai-compatible-local":
    raise SystemExit("engineering provider provenance is invalid")
if provider.get("deterministicProvider") is not False or provider.get("fallbackAllowed") is not False:
    raise SystemExit("engineering provider proof violates real-model constraints")
if cleanup.get("publicSchemaUnchanged") is not True or cleanup.get("publicSchemaUsed") is not False:
    raise SystemExit("engineering public schema isolation proof failed")

checkpoint = {
    "schemaVersion": 1,
    "checkpoint": "B0_ENGINEERING_SELFHOSTED_ACCEPTANCE",
    "status": "PASS",
    "testedCodeSha": os.environ["GITHUB_SHA"],
    "workflowRunId": os.environ["GITHUB_RUN_ID"],
    "workflowRunAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
    "acceptanceTier": "engineering-selfhosted",
    "formalC8Eligible": False,
    "formalC8Claimed": False,
    "supabaseCloudUsed": False,
    "database": {
        key: database[key]
        for key in (
            "provenance", "image", "imageDigest", "randomSchema",
            "randomSchemaDropped", "publicSchemaUsed", "publicSchemaUnchanged",
        )
    },
    "provider": {
        key: provider[key]
        for key in (
            "provenance", "image", "imageDigest", "model", "modelDigest",
            "postWarmupProductRequestCount", "deterministicProvider", "fallbackAllowed",
        )
    },
    "note": "This is engineering evidence only. It must never be used as the formal C8 Supabase-project checkpoint.",
}
(root / "engineering-checkpoint.json").write_text(
    json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

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
    "acceptanceTier": "engineering-selfhosted",
    "formalC8Eligible": False,
    "testedCodeSha": os.environ["GITHUB_SHA"],
    "workflowRunId": os.environ["GITHUB_RUN_ID"],
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "files": files,
}
(root / "artifact-catalog.json").write_text(
    json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY
}

redact() {
  ensure_evidence_root
  python3 - <<'PY'
import os
import re
from pathlib import Path

root = Path(os.environ["B0_EVIDENCE_ROOT"])
secret_values = [
    os.environ.get("DATABASE_URL", ""),
    os.environ.get("B0_DATABASE_PASSWORD", ""),
    os.environ.get("OPENOVEL_API_KEY", ""),
]
text_suffixes = {".json", ".jsonl", ".log", ".md", ".txt"}
for path in root.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in text_suffixes:
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    for value in secret_values:
        if value:
            text = text.replace(value, "[REDACTED]")
    text = re.sub(r"postgres(?:ql)?://[^\s\"']+", "[REDACTED_DATABASE_URL]", text, flags=re.I)
    text = re.sub(r"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", text, flags=re.I)
    path.write_text(text, encoding="utf-8")

patterns = [
    re.compile(r"postgres(?:ql)?://", re.I),
    re.compile(r"Bearer\s+(?!\[REDACTED\])", re.I),
    re.compile(r"(?:api[_-]?key|password|cookie|token)\s*[:=]\s*[\"']?(?!\[REDACTED\]|false|true|null)[A-Za-z0-9._~+/=-]{12,}", re.I),
]
failures = []
for path in root.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in text_suffixes:
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    for pattern in patterns:
        if pattern.search(text):
            failures.append(f"{path}: {pattern.pattern}")
if failures:
    raise SystemExit("Evidence redaction scan failed:\n" + "\n".join(failures))
PY
}

self_check() {
  bash -n "$0"
  case "${B0_DATABASE_IMAGE:-supabase/postgres:15.14.1.157-mmlb_amd64}" in
    supabase/postgres:*) ;;
    *) exit 1 ;;
  esac
  case "${B0_PROVIDER_IMAGE:-ollama/ollama:0.32.5}" in
    ollama/ollama:*) ;;
    *) exit 1 ;;
  esac
  if grep -Eq '"checkpoint"[[:space:]]*:[[:space:]]*"B0_C8_' "$0"; then
    echo "Self-hosted engineering script must not emit a formal C8 checkpoint" >&2
    exit 1
  fi
  echo B0_SELFHOSTED_REAL_ACCEPTANCE_SELF_CHECK_OK
}

case "$command_name" in
  prepare-database) prepare_database ;;
  prepare-provider) prepare_provider ;;
  provider-proof) provider_proof ;;
  cleanup) cleanup ;;
  finalize-engineering) finalize_engineering ;;
  redact) redact ;;
  self-check) self_check ;;
  *)
    echo "Usage: $0 {prepare-database|prepare-provider|provider-proof|cleanup|finalize-engineering|redact|self-check}" >&2
    exit 2
    ;;
esac
