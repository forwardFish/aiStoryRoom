param(
  [string]$ProjectRoot = (Get-Location).Path,
  [int]$Port = 55432
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$runtimeRoot = Join-Path $ProjectRoot ".runtime/postgres-ops-smoke"
$dataDir = Join-Path $runtimeRoot "data"
$walDir = Join-Path $runtimeRoot "wal-archive"
$logPath = Join-Path $runtimeRoot "postgres.log"
$backupDir = ".runtime/postgres-ops-smoke/backups"
$dbUrl = "postgresql://ai_story@127.0.0.1:$Port/ai_story_run"
$restoreUrl = "postgresql://ai_story@127.0.0.1:$Port/ai_story_restore"
$resultPath = Join-Path $ProjectRoot "docs/auto-execute/results/local-postgres-ops-$stamp.json"
$progressPath = Join-Path $runtimeRoot "progress.log"
$pgBin = Split-Path (Get-Command initdb -ErrorAction Stop).Source
$pgCtl = Join-Path $pgBin "pg_ctl.exe"
$postgres = Join-Path $pgBin "postgres.exe"
$initdb = Join-Path $pgBin "initdb.exe"
$createdb = Join-Path $pgBin "createdb.exe"
$psql = Join-Path $pgBin "psql.exe"
$serverStarted = $false
$serverProcess = $null
function Get-ProjectRelativePath([string]$Target) {
  $prefix = $ProjectRoot.TrimEnd('\') + '\'
  if ($Target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $Target.Substring($prefix.Length).Replace('\', '/') }
  return $Target
}

function Step([string]$Name) {
  Add-Content -Encoding UTF8 -LiteralPath $progressPath -Value "$(Get-Date -Format o) $Name"
  Write-Output "step=$Name"
}

function Assert-InProject([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Path escaped project root: $resolved" }
  return $resolved
}

function Invoke-Native([string]$File, [string[]]$Arguments) {
  $output = & $File @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "$File failed: $($output -join ' ')" }
  return ($output -join [Environment]::NewLine)
}

function Invoke-Pnpm([string[]]$Arguments) {
  $output = & pnpm @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "pnpm $($Arguments -join ' ') failed: $($output -join ' ')" }
  return ($output -join [Environment]::NewLine)
}

function Invoke-PowerShell([string]$File, [string[]]$Arguments) {
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $File @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "$File failed: $($output -join ' ')" }
  return ($output -join [Environment]::NewLine)
}

try {
  $runtimeRoot = Assert-InProject $runtimeRoot
  $walDir = Assert-InProject $walDir
  New-Item -ItemType Directory -Force -Path $runtimeRoot, $walDir | Out-Null
  if (Test-Path -LiteralPath $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force }

  Step "initdb"
  Invoke-Native $initdb @("-D", $dataDir, "-U", "ai_story", "-A", "trust", "--no-locale", "--encoding=UTF8") | Out-Null
  Step "initdb-complete"
  $archiveCmd = Join-Path $runtimeRoot "archive-wal.cmd"
  $walTarget = (($walDir -replace "\\", "/"))
  "@echo off`r`ncopy /Y `"%~1`" `"$walTarget/%~2`" >nul`r`nexit /b %ERRORLEVEL%`r`n" | Set-Content -Encoding ASCII -LiteralPath $archiveCmd
  $archiveCmdForConfig = ($archiveCmd -replace "\\", "/")
  @"
listen_addresses = '127.0.0.1'
port = $Port
archive_mode = on
archive_command = '$archiveCmdForConfig "%p" "%f"'
"@ | Add-Content -Encoding ASCII -LiteralPath (Join-Path $dataDir "postgresql.conf")

  Step "start-postgres"
  $serverStdout = Join-Path $runtimeRoot "postgres.stdout.log"
  $serverStderr = Join-Path $runtimeRoot "postgres.stderr.log"
  $serverProcess = Start-Process -FilePath $postgres -ArgumentList @("-D", $dataDir, "-p", "$Port", "-h", "127.0.0.1") -RedirectStandardOutput $serverStdout -RedirectStandardError $serverStderr -PassThru -WindowStyle Hidden
  if (-not $serverProcess) { throw "postgres process could not be started" }
  $serverStarted = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "PostgreSQL did not become ready on port $Port" }
  Step "start-postgres-complete"
  $serverStarted = $true
  Start-Sleep -Seconds 2
  Step "create-databases"
  Invoke-Native $createdb @("-h", "127.0.0.1", "-p", "$Port", "-U", "ai_story", "-w", "ai_story_run") | Out-Null
  Step "createdb-run-complete"
  Invoke-Native $createdb @("-h", "127.0.0.1", "-p", "$Port", "-U", "ai_story", "-w", "ai_story_restore") | Out-Null
  Step "createdb-restore-complete"

  $env:DATABASE_URL = $dbUrl
  $opsSchema = @"
create table "StoryRun" ("id" text primary key, "inviteCode" text unique not null, "stateJson" jsonb not null default '{}'::jsonb);
create table "StoryEvent" ("id" text primary key, "runId" text not null references "StoryRun"("id"), "day" integer not null, "type" text not null, "messageType" text not null, "visibility" text not null, "payloadJson" jsonb not null, "createdAt" timestamptz not null default now());
insert into "StoryRun" ("id", "inviteCode", "stateJson") values ('ops-smoke-run-1', 'LOCAL1', '{""source"":""local-postgres-ops""}'::jsonb);
insert into "StoryEvent" ("id", "runId", "day", "type", "messageType", "visibility", "payloadJson") values ('ops-smoke-event-1', 'ops-smoke-run-1', 1, 'ops_smoke', 'system', 'player_visible', '{""source"":""local-postgres-ops""}'::jsonb);
"@
  Step "create-storyrun-event-schema"
  Invoke-Native $psql @("-X", "-w", "-v", "ON_ERROR_STOP=1", "-c", $opsSchema, $dbUrl) | Out-Null
  Step "schema-complete"

  Step "backup"
  $backupOutput = Invoke-PowerShell -File (Join-Path $ProjectRoot "scripts/ops/backup-postgres.ps1") -Arguments @("-ProjectRoot", $ProjectRoot, "-Mode", "external", "-ConnectionString", $dbUrl, "-OutputDir", $backupDir)
  $latestBackup = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot $backupDir) -Filter "full-*.sql" -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $latestBackup) { throw "No local PostgreSQL backup was produced." }

  $oldBackup = Join-Path $latestBackup.DirectoryName "full-retention-fixture.sql"
  Copy-Item -LiteralPath $latestBackup.FullName -Destination $oldBackup -Force
  (Get-Item -LiteralPath $oldBackup).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddDays(-31)
  Invoke-PowerShell -File (Join-Path $ProjectRoot "scripts/ops/backup-postgres.ps1") -Arguments @("-ProjectRoot", $ProjectRoot, "-Mode", "external", "-ConnectionString", $dbUrl, "-OutputDir", $backupDir) | Out-Null
  $retentionCleanupPassed = -not (Test-Path -LiteralPath $oldBackup)
  if (-not $retentionCleanupPassed) { throw "30-day retention cleanup did not remove the old backup fixture." }

  $relativeBackup = Get-ProjectRelativePath $latestBackup.FullName
  Step "restore"
  Invoke-PowerShell -File (Join-Path $ProjectRoot "scripts/ops/restore-smoke.ps1") -Arguments @("-ProjectRoot", $ProjectRoot, "-Mode", "external", "-ConnectionString", $dbUrl, "-RestoreConnectionString", $restoreUrl, "-BackupPath", $relativeBackup) | Out-Null
  Step "wal-switch"
  Invoke-Native $psql @("-X", "-w", "-v", "ON_ERROR_STOP=1", "-At", "-c", "select pg_switch_wal();", $dbUrl) | Out-Null
  Invoke-PowerShell -File (Join-Path $ProjectRoot "scripts/ops/check-wal-archive.ps1") -Arguments @("-ProjectRoot", $ProjectRoot, "-Mode", "external", "-ConnectionString", $dbUrl) | Out-Null

  $backupEvidence = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "docs/auto-execute/results") -Filter "db-backup-*.json" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  $restoreEvidence = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "docs/auto-execute/results") -Filter "db-restore-smoke-*.json" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  $walEvidence = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "docs/auto-execute/results") -Filter "wal-archive-*.json" | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  $backupJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $backupEvidence.FullName | ConvertFrom-Json
  $restoreJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $restoreEvidence.FullName | ConvertFrom-Json
  $walJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $walEvidence.FullName | ConvertFrom-Json
  $result = [ordered]@{
    schemaVersion = "local-postgres-ops-acceptance-v1"
    status = if ($backupJson.status -eq "PASS" -and $restoreJson.status -eq "PASS" -and $walJson.status -eq "PASS" -and $retentionCleanupPassed) { "PASS" } else { "FAIL" }
    databaseTarget = "isolated-local-postgresql-16"
    schemaProvisioning = "minimal-storyrun-event-ops"
    backupEvidence = Get-ProjectRelativePath $backupEvidence.FullName
    restoreEvidence = Get-ProjectRelativePath $restoreEvidence.FullName
    walEvidence = Get-ProjectRelativePath $walEvidence.FullName
    retentionCleanupPassed = $retentionCleanupPassed
    storyRunCount = $backupJson.storyRunCount
    storyEventCount = $backupJson.storyEventCount
    rpoWithinTarget = ($walJson.status -eq "PASS")
    rtoWithinTarget = [bool]$restoreJson.rtoWithinTarget
    rtoSeconds = $restoreJson.rtoSeconds
    rpoTargetMinutes = 15
    rtoTargetHours = 2
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $result | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $resultPath
  Write-Output ($result | ConvertTo-Json -Depth 12)
} catch {
  $result = [ordered]@{ schemaVersion = "local-postgres-ops-acceptance-v1"; status = "FAIL"; error = $_.Exception.Message; rpoTargetMinutes = 15; rtoTargetHours = 2; completedAt = (Get-Date).ToUniversalTime().ToString("o") }
  $result | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -LiteralPath $resultPath
  Write-Output ($result | ConvertTo-Json -Depth 12)
  exit 1
} finally {
  if ($serverStarted) {
    try { & $pgCtl -D $dataDir -m fast -w stop 2>&1 | Out-Null } catch { }
    if ($serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
