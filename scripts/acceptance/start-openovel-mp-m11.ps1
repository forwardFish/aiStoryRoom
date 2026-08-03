param(
  [string]$ProjectRoot = "",
  [string]$ReportPath = "",
  [int]$RuntimePort = 3193,
  [int]$ApiPort = 3192,
  [int]$WebPort = 5192
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

function Set-DatabaseSchema([string]$Url, [string]$Schema, [int]$ConnectionLimit = 5) {
  $queryIndex = $Url.IndexOf("?")
  if ($queryIndex -ge 0) { $prefix = $Url.Substring(0, $queryIndex); $query = @($Url.Substring($queryIndex + 1).Split("&") | Where-Object { $_ -and $_ -notmatch "^(schema|connection_limit|sslmode)=" }) }
  else { $prefix = $Url; $query = @() }
  $query += "sslmode=disable"; $query += "schema=$Schema"; $query += "connection_limit=$ConnectionLimit"
  return "${prefix}?" + ($query -join "&")
}

function Assert-PortAvailable([int]$Port) {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  if ($listeners.Port -contains $Port) { throw "Port $Port is already listening" }
}

function Wait-Http([string]$Url, [System.Diagnostics.Process]$Process, [int]$Seconds = 45) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) { throw "Process $($Process.Id) exited with code $($Process.ExitCode) before $Url became ready" }
    try { $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3; if ($response.StatusCode -eq 200) { return } } catch {}
    Start-Sleep -Milliseconds 150
  }
  throw "Timed out waiting for $Url"
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $reports = @()
  $evidenceRoot = Join-Path $ProjectRoot "docs\auto-execute\evidence\openovel-multiplayer"
  foreach ($attemptDir in Get-ChildItem -LiteralPath $evidenceRoot -Directory) {
    $testResults = Join-Path $attemptDir.FullName "test-results"
    if (-not (Test-Path -LiteralPath $testResults)) { continue }
    foreach ($runDir in Get-ChildItem -LiteralPath $testResults -Directory -Filter "openovel-db-three-role-*") {
      $candidatePath = Join-Path $runDir.FullName "report.json"
      if (Test-Path -LiteralPath $candidatePath) { $reports += Get-Item -LiteralPath $candidatePath }
    }
  }
  $reports = $reports | Sort-Object LastWriteTime -Descending
  foreach ($candidate in $reports) {
    $payload = Get-Content -Raw -LiteralPath $candidate.FullName | ConvertFrom-Json
    if ($payload.status -eq "PASS") { $ReportPath = $candidate.FullName; break }
  }
}
if ([string]::IsNullOrWhiteSpace($ReportPath) -or -not (Test-Path -LiteralPath $ReportPath)) { throw "No PASS three-role report is available" }
$ReportPath = [System.IO.Path]::GetFullPath($ReportPath)
$report = Get-Content -Raw -LiteralPath $ReportPath | ConvertFrom-Json
if ($report.status -ne "PASS" -or $report.schemaVersion -ne "openovel_mp_three_role_e2e_v1") { throw "M11 requires a PASS OpenNovel three-role report" }
$schema = [string]$report.database.schema
$runId = [string]$report.runId
if (-not $schema.StartsWith("openovel_mp_") -or -not $runId.StartsWith("room_")) { throw "Refusing non-acceptance database identity" }

$envPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  $envPath = "D:\lyh\agent\agent-frame\aiStoryRoom\.env"
}
if (-not (Test-Path -LiteralPath $envPath)) { throw "No repository test .env is available" }
Import-DotEnv $envPath
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DATABASE_URL)) { throw "SUPABASE_DATABASE_URL is missing" }
if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) { throw "DEEPSEEK_API_KEY is missing" }
Assert-PortAvailable $RuntimePort; Assert-PortAvailable $ApiPort; Assert-PortAvailable $WebPort

$evidenceDir = Split-Path -Parent $ReportPath
$logsDir = Join-Path $evidenceDir "m11-live"
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
$databaseUrl = Set-DatabaseSchema $env:SUPABASE_DATABASE_URL $schema 6
$token = "openovel-m11-$($runId.Substring(5, 12))"
$providerBase = if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_BASE_URL)) { "https://api.deepseek.com" } else { $env:DEEPSEEK_BASE_URL }
$node = (Get-Command node).Source

$env:NODE_ENV = "production"
$env:PORT = [string]$RuntimePort
$env:OPENOVEL_RUNTIME_HOST = "127.0.0.1"
$env:OPENOVEL_WORKSPACE_ROOT = Join-Path $evidenceDir "runtime-workspaces"
$env:OPENOVEL_PROJECT_ROOT = $ProjectRoot
$env:OPENOVEL_INTERNAL_TOKEN = $token
$env:OPENOVEL_PROVIDER_BASE_URL = $providerBase
$env:OPENOVEL_API_KEY = $env:DEEPSEEK_API_KEY
$env:OPENOVEL_MODEL = "deepseek-chat"
$env:OPENOVEL_NARRATOR_MODEL = "deepseek-chat"
$env:OPENOVEL_OPTIONS_MODEL = "deepseek-chat"
$env:OPENOVEL_STORYKEEPER_MODEL = "deepseek-chat"
$env:OPENOVEL_MIRROR_URL = ""
$runtimeOut = Join-Path $logsDir "runtime.out.log"; $runtimeErr = Join-Path $logsDir "runtime.err.log"
$runtime = Start-Process -FilePath $node -ArgumentList @("--import", "tsx", "apps/openovel-runtime/src/server.ts") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $runtimeOut -RedirectStandardError $runtimeErr -PassThru

$env:NODE_ENV = "test"
$env:PORT = [string]$ApiPort
$env:DATABASE_URL = $databaseUrl
$env:MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = "true"
$env:CONTINUOUS_OPENOVEL_V1_ENABLED = "true"
$env:CONTINUOUS_OPENOVEL_ROOM_IDS = $runId
$env:OPENOVEL_RUNTIME_URL = "http://127.0.0.1:$RuntimePort"
$env:OPENOVEL_INTERNAL_TOKEN = $token
$env:STORY_WORKER_EMBEDDED = "true"
$env:STORY_WORKER_ENABLED = "true"
$env:STORY_NARRATIVE_PROVIDER = "deepseek"
$env:ROLE_AGENT_PROVIDER = "deepseek"
$env:ROLE_AGENT_MODEL = "deepseek-chat"
$env:CREDIT_DEFAULT_POLICY = "active_action_v1"
$env:CREDIT_ACTION_METERING_MODE = "OFF"
$env:AUTH_TOKEN_SECRET = "openovel-three-role-auth-secret"
$env:PUBLIC_WEB_URL = "http://127.0.0.1:$WebPort"
$env:CORS_ALLOWED_ORIGINS = "http://127.0.0.1:$WebPort,http://127.0.0.2:$WebPort,http://127.0.0.3:$WebPort,http://localhost:$WebPort"
$apiOut = Join-Path $logsDir "api.out.log"; $apiErr = Join-Path $logsDir "api.err.log"
$api = Start-Process -FilePath $node -ArgumentList @("apps/api/dist/main.js") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru

$env:PORT = [string]$WebPort
$env:API_PORT = [string]$ApiPort
$webOut = Join-Path $logsDir "web.out.log"; $webErr = Join-Path $logsDir "web.err.log"
$web = Start-Process -FilePath $node -ArgumentList @("apps/web/src/server.mjs") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru

try {
  Wait-Http "http://127.0.0.1:$RuntimePort/health" $runtime 45
  Wait-Http "http://127.0.0.1:$ApiPort/api/health/ready" $api 60
  Wait-Http "http://127.0.0.1:$WebPort/game?runId=$runId" $web 30
} catch {
  foreach ($process in @($web, $api, $runtime)) { if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } }
  throw
}

$state = [ordered]@{
  status = "READY"
  startedAt = (Get-Date).ToString("o")
  reportPath = $ReportPath
  schema = $schema
  runId = $runId
  urls = [ordered]@{
    governor = "http://127.0.0.1:$WebPort/game?runId=$runId"
    xunfu = "http://127.0.0.2:$WebPort/game?runId=$runId"
    magistrate = "http://127.0.0.3:$WebPort/game?runId=$runId"
  }
  accounts = [ordered]@{
    governor = "$runId-governor@example.test"
    xunfu = "$runId-xunfu@example.test"
    magistrate = "$runId-magistrate@example.test"
  }
  runtime = [ordered]@{ pid = $runtime.Id; out = $runtimeOut; err = $runtimeErr }
  api = [ordered]@{ pid = $api.Id; out = $apiOut; err = $apiErr }
  web = [ordered]@{ pid = $web.Id; out = $webOut; err = $webErr }
}
$statePath = Join-Path $logsDir "stack.json"
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
$state | ConvertTo-Json -Depth 5
