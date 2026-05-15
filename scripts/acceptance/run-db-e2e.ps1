param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast", [string]$BackendDir = "")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
if ($Mode -eq "fast") {
  Add-VerificationResult $ProjectRoot "db-e2e" "DEFERRED" "Skipped in fast mode" ""
  Write-LaneResult $ProjectRoot "db-e2e" "DEFERRED" @() @() @("Skipped in fast mode") @("Run -Mode gate or -Mode full with safe local test DB.")
  Write-Host "[DEFERRED] db-e2e fast mode"
  exit 0
}
if ([string]::IsNullOrWhiteSpace($BackendDir)) {
  if (Test-Path -LiteralPath (Join-Path $ProjectRoot "docker-compose.test.yml")) {
    $BackendDir = $ProjectRoot
  } elseif (Test-Path -LiteralPath (Join-Path $ProjectRoot "docker-compose.yml")) {
    $BackendDir = $ProjectRoot
  } else {
    $BackendDir = Join-Path $ProjectRoot "backend"
  }
}
$compose = Join-Path $BackendDir "docker-compose.test.yml"
if (!(Test-Path -LiteralPath $compose)) {
  $rootCompose = Join-Path $BackendDir "docker-compose.yml"
  if (Test-Path -LiteralPath $rootCompose) {
    $compose = $rootCompose
  } else {
    Add-Blocker $ProjectRoot "db-e2e" "DEFERRED" "No docker-compose.test.yml or docker-compose.yml found for safe local DB E2E"
    Write-LaneResult $ProjectRoot "db-e2e" "DEFERRED" @() @() @("No docker-compose.test.yml or docker-compose.yml found for safe local DB E2E") @()
    exit 0
  }
}
if (!(Test-CommandExists "docker")) { Add-Blocker $ProjectRoot "db-e2e" "DOCUMENTED_BLOCKER" "Docker unavailable"; Write-LaneResult $ProjectRoot "db-e2e" "DOCUMENTED_BLOCKER" @() @() @("Docker unavailable") @(); exit 0 }
if (Test-UnsafeDatabaseUrl $env:DATABASE_URL) { Add-Blocker $ProjectRoot "db-e2e" "DOCUMENTED_BLOCKER" "DATABASE_URL looks unsafe"; Write-LaneResult $ProjectRoot "db-e2e" "DOCUMENTED_BLOCKER" @() @() @("DATABASE_URL looks unsafe") @(); exit 0 }
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $log = Join-Path (Get-AEPaths $ProjectRoot).Logs "db-docker-info.log"
  & docker info *>&1 | Tee-Object -FilePath $log | Out-Null
  Add-Blocker $ProjectRoot "db-e2e" "DOCUMENTED_BLOCKER" "Docker CLI is installed but Docker daemon is unavailable or Docker Desktop is unable to start"
  Write-LaneResult $ProjectRoot "db-e2e" "DOCUMENTED_BLOCKER" @(@{ command="docker info"; status="DOCUMENTED_BLOCKER"; log="docs/auto-execute/logs/db-docker-info.log" }) @("docs/auto-execute/logs/db-docker-info.log") @("Docker CLI is installed but Docker daemon is unavailable or Docker Desktop is unable to start") @("Start Docker Desktop successfully, then rerun db-e2e/full convergence.")
  exit 0
}
Push-Location $BackendDir
try {
  $commands = @()
  $hardFail = $false
  $ok = Invoke-Gate $ProjectRoot "db:docker-ps" { docker ps } "db-docker-ps.log"
  $commands += @{ command = "docker ps"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/db-docker-ps.log" }
  if (-not $ok) { $hardFail = $true }
  $composeRel = Get-RelativeEvidencePath $ProjectRoot $compose
  $ok = Invoke-Gate $ProjectRoot "db:compose-up" { docker compose -f $compose up -d postgres redis } "db-compose-up.log"
  $commands += @{ command = "docker compose -f $composeRel up -d postgres redis"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/db-compose-up.log" }
  if (-not $ok) { $hardFail = $true }

  if (-not $hardFail) {
    $ready = $false
    for ($i = 1; $i -le 24; $i++) {
      & docker compose -f $compose ps *> (Join-Path $p.Logs "db-compose-ps.log")
      $statusText = Get-Content -LiteralPath (Join-Path $p.Logs "db-compose-ps.log") -Raw -ErrorAction SilentlyContinue
      if ($statusText -match "healthy" -or $statusText -match "running") { $ready = $true; break }
      Start-Sleep -Seconds 5
    }
    $commands += @{ command = "docker compose -f $composeRel ps"; status = $(if ($ready) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/db-compose-ps.log" }
    if (-not $ready) {
      Add-Blocker $ProjectRoot "db-e2e" "HARD_FAIL" "Docker compose services did not become ready"
      $hardFail = $true
    }
  }

  if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    $env:DATABASE_URL = "postgresql://ai_story:ai_story_pwd@localhost:5432/ai_story_run?schema=public"
  }
  $scripts = Read-PackageScripts "package.json"
  foreach ($s in @("db:generate","db:push","db:seed","test:api","e2e:db:up","e2e:db:ps","e2e:db:push","e2e:db:seed","test:e2e:runtime:db","e2e:db:all")) {
    if ($scripts.ContainsKey($s)) {
      $logName = "db-$($s -replace ':','-').log"
      $ok = Invoke-Gate $ProjectRoot "db:$s" { pnpm $s } $logName
      $commands += @{ command = "pnpm $s"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/$logName" }
      if (-not $ok) { $hardFail = $true }
    }
  }
  if (-not $hardFail) {
    $probeLog = Join-Path $p.Logs "db-prisma-probe.log"
    $probe = @"
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const result = {
  users: await prisma.user.count(),
  storyRuns: await prisma.storyRun.count(),
  roles: await prisma.storyRole.count(),
  nodes: await prisma.sceneNode.count(),
  templates: ['template_midnight_store_001','template_qingyun_sect_001','template_wild_village_001']
};
console.log(JSON.stringify(result, null, 2));
await prisma.`$disconnect();
"@
    $probe | pnpm exec tsx - *>&1 | Tee-Object -FilePath $probeLog
    $ok = ($LASTEXITCODE -eq 0)
    $commands += @{ command = "pnpm exec tsx prisma count probe"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/db-prisma-probe.log" }
    if (-not $ok) { $hardFail = $true }
  }
  Write-LaneResult $ProjectRoot "db-e2e" $(if ($hardFail) { "HARD_FAIL" } else { "PASS" }) $commands @("docs/auto-execute/logs","docs/auto-execute/logs/db-prisma-probe.log") $(if ($hardFail) { @("One or more DB E2E gates failed") } else { @() }) @()
} finally { Pop-Location }
