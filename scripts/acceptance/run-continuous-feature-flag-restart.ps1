param(
  [string]$ProjectRoot = "D:\lyh\agent\agent-frame\aiStoryRoom",
  [int]$ApiPort = 3128,
  [string]$EvidenceRoot = "D:\tmp\continuous-feature-flag-restart",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param([Parameter(Mandatory = $true)][string]$Path)
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
    $pair = $line.Split("=", 2)
    $key = $pair[0].Trim()
    $value = $pair[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

function Set-DatabaseSchema {
  param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Schema)
  $queryIndex = $Url.IndexOf("?")
  if ($queryIndex -ge 0) {
    $prefix = $Url.Substring(0, $queryIndex)
    $query = @($Url.Substring($queryIndex + 1).Split("&") | Where-Object { $_ -and $_ -notmatch "^(schema|connection_limit|sslmode)=" })
  } else {
    $prefix = $Url
    $query = @()
  }
  $query += "sslmode=disable"
  $query += "schema=$Schema"
  $query += "connection_limit=5"
  return "${prefix}?" + ($query -join "&")
}

function Wait-Api {
  param([int]$Port, [System.Diagnostics.Process]$Process)
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) { throw "API exited before readiness with code $($Process.ExitCode)" }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  throw "API did not become ready on port $Port"
}

function Stop-AcceptanceProcess {
  param([System.Diagnostics.Process]$Process)
  if (-not $Process -or $Process.HasExited) { return }
  Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  $Process.WaitForExit(5000) | Out-Null
}

function Start-AcceptancePair {
  param([bool]$FlagEnabled, [string]$Label)
  $env:MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = if ($FlagEnabled) { "true" } else { "false" }
  $apiOut = Join-Path $EvidenceRoot "$Label-api.out.log"
  $apiErr = Join-Path $EvidenceRoot "$Label-api.err.log"
  $workerOut = Join-Path $EvidenceRoot "$Label-worker.out.log"
  $workerErr = Join-Path $EvidenceRoot "$Label-worker.err.log"
  $env:PORT = [string]$ApiPort
  $api = Start-Process -FilePath $script:NodePath -ArgumentList @("apps/api/dist/main.js") -WorkingDirectory $ProjectRoot -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -WindowStyle Hidden -PassThru
  $worker = Start-Process -FilePath $script:NodePath -ArgumentList @("apps/api/dist/worker.js") -WorkingDirectory $ProjectRoot -RedirectStandardOutput $workerOut -RedirectStandardError $workerErr -WindowStyle Hidden -PassThru
  Wait-Api -Port $ApiPort -Process $api
  return [ordered]@{ api = $api; worker = $worker; apiOut = $apiOut; apiErr = $apiErr; workerOut = $workerOut; workerErr = $workerErr }
}

$envPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing .env at $envPath" }
if (Get-NetTCPConnection -State Listen -LocalPort $ApiPort -ErrorAction SilentlyContinue) { throw "Port $ApiPort is already listening" }
New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
Import-DotEnv -Path $envPath
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DATABASE_URL)) { throw "SUPABASE_DATABASE_URL is missing" }
if ($env:SUPABASE_DATABASE_URL -notmatch "supabase") { throw "D11 acceptance requires Supabase; refusing a non-Supabase URL" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$schema = "cs_accept_flag_$stamp"
$env:DATABASE_URL = Set-DatabaseSchema -Url $env:SUPABASE_DATABASE_URL -Schema $schema
$env:MANY_WORLDS_DB_SCHEMA = $schema
$env:MANY_WORLDS_API_BASE = "http://127.0.0.1:$ApiPort/api"
$env:MANY_WORLDS_STATE_PATH = Join-Path $EvidenceRoot "state.json"
$env:MANY_WORLDS_EVIDENCE_PATH = Join-Path $EvidenceRoot "report.json"
$env:AUTH_MAIL_SINK_FILE = Join-Path $EvidenceRoot "mail.ndjson"
$env:NODE_ENV = "test"
$env:STORY_WORKER_EMBEDDED = "false"
# The D11 process restart is deliberately slower than an ordinary page refresh.
# Keep the frozen human controls alive across that restart without weakening the
# production realtime profile used by the browser acceptance stack.
$env:CONTINUOUS_TIMING_PROFILE = "manual-three-page"
$env:ROLE_AGENT_PROVIDER = "rules"
$env:EMAIL_PROVIDER = "file-sink"
$env:PUBLIC_WEB_URL = "http://127.0.0.1:5218"
$env:ALLOW_TEST_CREDIT_GRANT = "true"
$env:STORY_TASK_LEASE_MS = "60000"
$env:CORS_ALLOWED_ORIGINS = "http://127.0.0.1:5218"
$env:NODE_PATH = (Join-Path $ProjectRoot "apps\api\node_modules") + ";" + (Join-Path $ProjectRoot "node_modules")
Set-Content -LiteralPath $env:AUTH_MAIL_SINK_FILE -Value "" -Encoding utf8

$script:NodePath = (Get-Command node).Source
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = (Get-Command pnpm).Source }
$first = $null
$second = $null

try {
  Push-Location $ProjectRoot
  if (-not $SkipBuild) {
    & $pnpm build:api
    if ($LASTEXITCODE -ne 0) { throw "API build failed with exit code $LASTEXITCODE" }
  }
  & $pnpm exec prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "Supabase migrate deploy failed with exit code $LASTEXITCODE" }

  $first = Start-AcceptancePair -FlagEnabled $true -Label "before-restart"
  $env:ACCEPTANCE_API_PID = [string]$first.api.Id
  $env:ACCEPTANCE_WORKER_PID = [string]$first.worker.Id
  & $pnpm exec tsx scripts/e2e/continuous-strategy-feature-flag-restart.ts prepare
  if ($LASTEXITCODE -ne 0) { throw "Feature-flag prepare phase failed with exit code $LASTEXITCODE" }
  Stop-AcceptanceProcess -Process $first.worker
  Stop-AcceptanceProcess -Process $first.api

  $second = Start-AcceptancePair -FlagEnabled $false -Label "after-restart"
  $env:ACCEPTANCE_API_PID = [string]$second.api.Id
  $env:ACCEPTANCE_WORKER_PID = [string]$second.worker.Id
  & $pnpm exec tsx scripts/e2e/continuous-strategy-feature-flag-restart.ts verify
  if ($LASTEXITCODE -ne 0) { throw "Feature-flag verify phase failed with exit code $LASTEXITCODE" }

  $report = Get-Content -Raw -LiteralPath $env:MANY_WORLDS_EVIDENCE_PATH | ConvertFrom-Json
  if ($report.status -ne "PASS" -or $report.database.provider -ne "supabase" -or $report.database.schema -ne $schema) {
    throw "D11 report did not prove a Supabase PASS"
  }
  [ordered]@{
    status = "PASS"
    checkpoint = "D11_FEATURE_FLAG_RESTART"
    database = [ordered]@{ provider = "supabase"; schema = $schema }
    report = $env:MANY_WORLDS_EVIDENCE_PATH
    apiPidBefore = $first.api.Id
    apiPidAfter = $second.api.Id
    workerPidBefore = $first.worker.Id
    workerPidAfter = $second.worker.Id
  } | ConvertTo-Json -Depth 4
} finally {
  if ($second) {
    Stop-AcceptanceProcess -Process $second.worker
    Stop-AcceptanceProcess -Process $second.api
  }
  if ($first) {
    Stop-AcceptanceProcess -Process $first.worker
    Stop-AcceptanceProcess -Process $first.api
  }
  Pop-Location -ErrorAction SilentlyContinue
}
