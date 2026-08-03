param(
  [ValidateSet("concurrency", "fault", "three-role", "performance", "transport")][string]$Lane = "concurrency",
  [string]$ProjectRoot = "",
  [string]$EvidenceRoot = "",
  [string]$ProvisionedSchema = "",
  [switch]$ProvisionOnly,
  [ValidateSet("session", "transaction")][string]$DatabaseMode = "session",
  [int]$RuntimePort = 3117
)

$ErrorActionPreference = "Stop"
$ProjectRoot = if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..")) } else { [System.IO.Path]::GetFullPath($ProjectRoot) }

function Import-DotEnv([string]$Path) {
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
    $pair = $line.Split("=", 2); $key = $pair[0].Trim(); $value = $pair[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { $value = $value.Substring(1, $value.Length - 2) }
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

function Set-DatabaseSchema([string]$Url, [string]$Schema, [int]$ConnectionLimit = 5, [int]$PoolTimeout = 10, [bool]$Pgbouncer = $false) {
  $queryIndex = $Url.IndexOf("?")
  if ($queryIndex -ge 0) { $prefix = $Url.Substring(0, $queryIndex); $query = @($Url.Substring($queryIndex + 1).Split("&") | Where-Object { $_ -and $_ -notmatch "^(schema|connection_limit|pool_timeout|sslmode|pgbouncer)=" }) }
  else { $prefix = $Url; $query = @() }
  $query += "sslmode=disable"; $query += "schema=$Schema"; $query += "connection_limit=$ConnectionLimit"; $query += "pool_timeout=$PoolTimeout"
  if ($Pgbouncer) { $query += "pgbouncer=true" }
  return "${prefix}?" + ($query -join "&")
}

$envPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  $currentWorktree = $null
  $mainWorktree = $null
  foreach ($line in @(& git -C $ProjectRoot worktree list --porcelain)) {
    if ($line.StartsWith("worktree ")) { $currentWorktree = $line.Substring(9) }
    elseif ($line -eq "branch refs/heads/main" -and $currentWorktree) { $mainWorktree = $currentWorktree }
  }
  if ($mainWorktree) { $envPath = Join-Path $mainWorktree ".env" }
}
if (-not (Test-Path -LiteralPath $envPath)) { throw "No repository test environment file is available" }
Import-DotEnv $envPath
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DATABASE_URL)) { throw "SUPABASE_DATABASE_URL is missing" }
if ($env:SUPABASE_DATABASE_URL -notmatch "supabase") { throw "OpenNovel DB acceptance requires the isolated Supabase test route" }
$databaseBaseUrl = if ($DatabaseMode -eq "transaction") {
  if ($env:SUPABASE_DATABASE_URL -notmatch ':5432(?=/|\?|$)') { throw "Supabase session URL must expose port 5432 before transaction-mode conversion" }
  $env:SUPABASE_DATABASE_URL -replace ':5432(?=/|\?|$)', ':6543'
} else {
  $env:SUPABASE_DATABASE_URL
}
$usePgbouncer = $DatabaseMode -eq "transaction"
if ($Lane -eq "fault") {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  if ($listeners.Port -contains $RuntimePort) { throw "Runtime port $RuntimePort is already listening" }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$reuseProvisionedSchema = -not [string]::IsNullOrWhiteSpace($ProvisionedSchema)
if ($ProvisionOnly -and $reuseProvisionedSchema) { throw "ProvisionOnly cannot reuse an existing schema" }
if ($reuseProvisionedSchema -and $ProvisionedSchema -notmatch '^openovel_mp_[a-zA-Z0-9_]+$') {
  throw "ProvisionedSchema must be an isolated openovel_mp_* schema"
}
$schema = if ($reuseProvisionedSchema) { $ProvisionedSchema } else { "openovel_mp_$($stamp.Replace('-','_'))_$suffix" }
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
  $state = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot "docs\auto-execute\openovel-multiplayer\state.json") | ConvertFrom-Json
  $EvidenceRoot = Join-Path $ProjectRoot "docs\auto-execute\evidence\openovel-multiplayer\$($state.attempt_id)\test-results\openovel-db-$Lane-$stamp"
}
$EvidenceRoot = [System.IO.Path]::GetFullPath($EvidenceRoot)
New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
$env:DATABASE_URL = if ($Lane -eq "performance") {
  Set-DatabaseSchema $databaseBaseUrl $schema 15 60 $usePgbouncer
} elseif ($Lane -eq "three-role") {
  # The driver and product API are separate Prisma clients. Supabase session
  # mode caps the whole project pool at 15, so never give both clients the full
  # pool_size. Keep two connections in reserve for control-plane/readback use.
  Set-DatabaseSchema $databaseBaseUrl $schema 3 60 $usePgbouncer
} else {
  Set-DatabaseSchema $databaseBaseUrl $schema 5 10 $usePgbouncer
}
$env:OPENOVEL_MP_API_DATABASE_URL = if ($Lane -eq "three-role") {
  Set-DatabaseSchema $databaseBaseUrl $schema 10 60 $usePgbouncer
} else {
  $env:DATABASE_URL
}
$env:OPENOVEL_MP_DRIVER_CONNECTION_LIMIT = if ($Lane -eq "three-role") { "3" } else { "" }
$env:OPENOVEL_MP_API_CONNECTION_LIMIT = if ($Lane -eq "three-role") { "10" } else { "" }
$env:OPENOVEL_MP_DB_CONNECTION_MODE = $DatabaseMode
$env:OPENOVEL_MP_DB_SCHEMA = $schema
$env:OPENOVEL_MP_DB_PROVISIONING = if ($reuseProvisionedSchema) { "PREPROVISIONED_SCHEMA_REUSED" } else { "FRESH_SCHEMA_MIGRATED_IN_RUN" }
$env:OPENOVEL_MP_EVIDENCE_DIR = $EvidenceRoot
$env:OPENOVEL_MP_LANE = $Lane
$env:OPENOVEL_RUNTIME_URL = "http://127.0.0.1:$RuntimePort"
$env:OPENOVEL_INTERNAL_TOKEN = "openovel-db-$suffix"
$env:OPENOVEL_WORKSPACE_ROOT = Join-Path $EvidenceRoot "runtime-workspaces"
$env:OPENOVEL_PROJECT_ROOT = $ProjectRoot
$env:OPENOVEL_RUNTIME_HOST = "127.0.0.1"
$env:PORT = [string]$RuntimePort
$env:NODE_ENV = "production"
$runtime = $null

try {
  Push-Location $ProjectRoot
  if (-not $reuseProvisionedSchema) {
    & pnpm exec prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "Isolated schema migration failed with exit code $LASTEXITCODE" }
  }
  $cleanCheckJson = (& node scripts/e2e/openovel-mp-schema-clean-check.mjs | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Isolated schema clean check failed with exit code $LASTEXITCODE" }
  $cleanCheck = $cleanCheckJson | ConvertFrom-Json
  if ($ProvisionOnly) {
    $provisionReport = [ordered]@{
      schemaVersion = "openovel_mp_schema_provision_v1"
      status = "PASS"
      service = "supabase"
      schema = $schema
      provisioning = "FRESH_SCHEMA_MIGRATED_IN_RUN"
      connectionMode = $DatabaseMode
      cleanCheck = $cleanCheck
      completedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    $provisionJson = $provisionReport | ConvertTo-Json -Depth 8
    Set-Content -LiteralPath (Join-Path $EvidenceRoot "provision.json") -Value $provisionJson -Encoding utf8
    Write-Output $provisionJson
    return
  }
  if ($Lane -eq "fault") {
    $runtimeOut = Join-Path $EvidenceRoot "runtime.out.log"
    $runtimeErr = Join-Path $EvidenceRoot "runtime.err.log"
    $runtime = Start-Process -FilePath (Get-Command node).Source -ArgumentList @("--import", "tsx", "apps/openovel-runtime/src/server.ts") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $runtimeOut -RedirectStandardError $runtimeErr -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      if ($runtime.HasExited) { throw "OpenNovel runtime exited before readiness with code $($runtime.ExitCode)" }
      try { $response = Invoke-WebRequest -UseBasicParsing -Uri "$($env:OPENOVEL_RUNTIME_URL)/health" -TimeoutSec 2; if ($response.StatusCode -eq 200) { break } } catch { Start-Sleep -Milliseconds 100 }
    }
    if ((Get-Date) -ge $deadline) { throw "OpenNovel runtime did not become ready" }
  }
  if ($Lane -eq "three-role") {
    & pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/e2e/openovel-mp-three-role.ts
  } elseif ($Lane -eq "performance") {
    & pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/e2e/openovel-mp-performance.ts
  } elseif ($Lane -eq "transport") {
    & pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/e2e/openovel-mp-transport.ts
  } else {
    & pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/e2e/openovel-mp-commit-entry-acceptance.ts
    if ($LASTEXITCODE -ne 0) { throw "OpenNovel commit-entry $Lane lane failed with exit code $LASTEXITCODE" }
    & node --import tsx scripts/e2e/openovel-mp-db-concurrency.ts
  }
  if ($LASTEXITCODE -ne 0) { throw "OpenNovel DB $Lane lane failed with exit code $LASTEXITCODE" }
  Get-Content -Raw -LiteralPath (Join-Path $EvidenceRoot "report.json")
} finally {
  if ($runtime -and -not $runtime.HasExited) { Stop-Process -Id $runtime.Id -Force -ErrorAction SilentlyContinue; $runtime.WaitForExit(5000) | Out-Null }
  Pop-Location -ErrorAction SilentlyContinue
}
