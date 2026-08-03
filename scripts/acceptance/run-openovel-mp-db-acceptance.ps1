param(
  [ValidateSet("concurrency", "fault", "three-role", "performance", "transport")][string]$Lane = "concurrency",
  [string]$ProjectRoot = "",
  [string]$EvidenceRoot = "",
  [string]$ProvisionedSchema = "",
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

function Set-DatabaseSchema([string]$Url, [string]$Schema, [int]$ConnectionLimit = 5, [int]$PoolTimeout = 10) {
  $queryIndex = $Url.IndexOf("?")
  if ($queryIndex -ge 0) { $prefix = $Url.Substring(0, $queryIndex); $query = @($Url.Substring($queryIndex + 1).Split("&") | Where-Object { $_ -and $_ -notmatch "^(schema|connection_limit|pool_timeout|sslmode)=" }) }
  else { $prefix = $Url; $query = @() }
  $query += "sslmode=disable"; $query += "schema=$Schema"; $query += "connection_limit=$ConnectionLimit"; $query += "pool_timeout=$PoolTimeout"
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
if ($Lane -eq "fault") {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  if ($listeners.Port -contains $RuntimePort) { throw "Runtime port $RuntimePort is already listening" }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$reuseProvisionedSchema = -not [string]::IsNullOrWhiteSpace($ProvisionedSchema)
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
$env:DATABASE_URL = if ($Lane -in @("performance", "three-role")) { Set-DatabaseSchema $env:SUPABASE_DATABASE_URL $schema 15 60 } else { Set-DatabaseSchema $env:SUPABASE_DATABASE_URL $schema 5 10 }
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
