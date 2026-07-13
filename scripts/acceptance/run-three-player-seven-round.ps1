param(
  [string]$ProjectRoot = (Get-Location).Path,
  [int]$ApiPort = 3101,
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [int]$IsolatedDatabasePort = 15432,
  [switch]$KeepDatabase
)

$ErrorActionPreference = "Continue"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$evidenceDir = Join-Path $ProjectRoot "docs\auto-execute\results"
$logDir = Join-Path $ProjectRoot "docs\auto-execute\logs"
New-Item -ItemType Directory -Force -Path $evidenceDir,$logDir | Out-Null

if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
  throw "DEEPSEEK_API_KEY must be supplied in the current shell; the runner never writes it to disk."
}

$old = @{
  DATABASE_URL = $env:DATABASE_URL
  API_PORT = $env:API_PORT
  API_BASE = $env:API_BASE
  AI_DIRECTOR_PROVIDER = $env:AI_DIRECTOR_PROVIDER
  DEEPSEEK_MODEL = $env:DEEPSEEK_MODEL
}
$apiProcess = $null
$testContainer = $null
function Restore-Environment {
  foreach ($name in $old.Keys) {
    if ($null -eq $old[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $old[$name] }
  }
}
function Stop-Tree($proc) {
  if ($null -ne $proc -and -not $proc.HasExited) {
    try { taskkill.exe /PID $proc.Id /T /F | Out-Null } catch { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  }
}
function Wait-Health($url, $seconds = 45) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { return Invoke-RestMethod -Uri $url -TimeoutSec 5 } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "Timed out waiting for $url"
}
function Invoke-PnpmLogged([string]$scriptName, [string]$logPath) {
  & pnpm.cmd $scriptName *>&1 | Tee-Object -FilePath $logPath
  if ($LASTEXITCODE -ne 0) { throw "pnpm $scriptName failed with exit code $LASTEXITCODE" }
}

try {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker CLI is unavailable and no DatabaseUrl was supplied" }
    $testContainer = "ai_story_run_postgres_test_$PID"
    docker rm -f $testContainer 2>$null | Out-Null
    docker run --name $testContainer -e POSTGRES_USER=ai_story -e POSTGRES_PASSWORD=ai_story_pwd -e POSTGRES_DB=ai_story_run -p "${IsolatedDatabasePort}:5432" -d postgres:16-alpine | Tee-Object -FilePath (Join-Path $logDir "triad-docker-run.log")
    if ($LASTEXITCODE -ne 0) { throw "Could not start isolated Postgres test container" }
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
      docker exec $testContainer pg_isready -U ai_story -d ai_story_run *> $null
      if ($LASTEXITCODE -eq 0) { $ready = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw "Isolated Postgres test container did not become ready" }
    $DatabaseUrl = "postgresql://ai_story:ai_story_pwd@127.0.0.1:$IsolatedDatabasePort/ai_story_run?schema=public"
  }
  $env:DATABASE_URL = $DatabaseUrl
  $env:API_PORT = [string]$ApiPort
  $env:API_BASE = "http://127.0.0.1:$ApiPort/api"
  $env:AI_DIRECTOR_PROVIDER = "deepseek"
  $env:DEEPSEEK_MODEL = "deepseek-v4-pro"

  Invoke-PnpmLogged "db:generate" (Join-Path $logDir "triad-db-generate.log")
  Invoke-PnpmLogged "db:push" (Join-Path $logDir "triad-db-push.log")
  Invoke-PnpmLogged "db:seed" (Join-Path $logDir "triad-db-seed.log")

  $apiOut = Join-Path $logDir "triad-api.out.log"
  $apiErr = Join-Path $logDir "triad-api.err.log"
  $apiProcess = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev:api" -WorkingDirectory $ProjectRoot -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru -WindowStyle Hidden
  Wait-Health "$env:API_BASE/health" | Out-Null

  Invoke-PnpmLogged "test:story:triad" (Join-Path $logDir "triad-seven-round.log")

  $latest = Get-ChildItem (Join-Path $ProjectRoot "scripts\test-reports") -Filter "three-player-seven-round-*.json" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw "Triad test did not produce a JSON report" }
  Copy-Item $latest.FullName (Join-Path $evidenceDir "three-player-seven-round.json") -Force
  Write-Output "PASS three-player-seven-round"
  Write-Output "Evidence: docs/auto-execute/results/three-player-seven-round.json"
}
finally {
  Stop-Tree $apiProcess
  if ($testContainer -and -not $KeepDatabase) { docker rm -f $testContainer 2>$null | Out-Null }
  Restore-Environment
}
