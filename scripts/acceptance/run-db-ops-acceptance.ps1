param(
  [string]$ProjectRoot = (Get-Location).Path,
  [ValidateSet("auto", "docker", "external")][string]$Mode = "auto",
  [string]$ConnectionString = "",
  [string]$RestoreConnectionString = ""
)

$ErrorActionPreference = "Continue"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
function Get-ProjectRelativePath([string]$Target) {
  $prefix = $ProjectRoot.TrimEnd('\') + '\'
  if ($Target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $Target.Substring($prefix.Length).Replace('\', '/') }
  return $Target
}

function Get-ProjectEnvValue([string]$Name) {
  $envPath = Join-Path $ProjectRoot ".env"
  if (-not (Test-Path -LiteralPath $envPath)) { return $null }
  foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)$") {
      $value = $matches[1].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
      return $value
    }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($ConnectionString)) { $ConnectionString = Get-ProjectEnvValue "DATABASE_URL" }
if ([string]::IsNullOrWhiteSpace($RestoreConnectionString)) { $RestoreConnectionString = Get-ProjectEnvValue "RESTORE_DATABASE_URL" }
if ($Mode -eq "auto") { $Mode = if ([string]::IsNullOrWhiteSpace($ConnectionString)) { "docker" } else { "external" } }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$resultPath = Join-Path $ProjectRoot "docs/auto-execute/results/db-ops-acceptance-$stamp.json"
New-Item -ItemType Directory -Force -Path (Split-Path $resultPath) | Out-Null

if ($Mode -eq "docker") {
  $dockerOut = Join-Path $env:TEMP "ai-story-docker-$stamp.txt"
  $dockerErr = Join-Path $env:TEMP "ai-story-docker-$stamp.err.txt"
  $dockerProcess = Start-Process -FilePath "docker.exe" -ArgumentList @("version", "--format", "{{.Server.Version}}") -RedirectStandardOutput $dockerOut -RedirectStandardError $dockerErr -PassThru -WindowStyle Hidden
  if (-not $dockerProcess.WaitForExit(7000)) {
    Stop-Process -Id $dockerProcess.Id -Force -ErrorAction SilentlyContinue
    $dockerVersion = "Docker Engine probe timed out after 7 seconds."
    $result = [ordered]@{
      schemaVersion = "db-ops-acceptance-v2"
      status = "BLOCKED_BY_ENVIRONMENT"
      mode = "docker"
      blocker = "Docker Engine is unavailable or not responding; use Supabase/external PostgreSQL mode or restore Docker."
      dockerOutput = $dockerVersion
      requiredEvidence = @("daily full backup", "15-minute WAL archive", "30-day retention", "restore rehearsal", "RPO <= 15 minutes", "RTO <= 2 hours")
      rpoTargetMinutes = 15
      rtoTargetHours = 2
      nextAction = "Provide DATABASE_URL and RESTORE_DATABASE_URL for Supabase mode, then rerun pnpm test:db-ops; Docker remains optional."
      completedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    $result | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $resultPath
    Write-Output ($result | ConvertTo-Json -Depth 10)
    exit 0
  }
  $probeStdout = if (Test-Path -LiteralPath $dockerOut) { (Get-Content -Raw -LiteralPath $dockerOut).Trim() } else { "" }
  $probeStderr = if (Test-Path -LiteralPath $dockerErr) { (Get-Content -Raw -LiteralPath $dockerErr).Trim() } else { "" }
  if ([string]::IsNullOrWhiteSpace($probeStdout) -or $probeStderr -match "(?i)error|unable|not found|pipe") {
    $result = [ordered]@{
      schemaVersion = "db-ops-acceptance-v2"
      status = "BLOCKED_BY_ENVIRONMENT"
      mode = "docker"
      blocker = "Docker client is present but the Docker Engine API is unavailable; use Supabase/external PostgreSQL mode or restore Docker."
      dockerOutput = (($probeStdout + "`n" + $probeStderr).Trim() -replace "(?i)Bearer\s+\S+", "Bearer [REDACTED]" -replace "sk-[A-Za-z0-9._-]+", "sk-[REDACTED]")
      requiredEvidence = @("daily full backup", "15-minute WAL archive", "30-day retention", "restore rehearsal", "RPO <= 15 minutes", "RTO <= 2 hours")
      rpoTargetMinutes = 15
      rtoTargetHours = 2
      nextAction = "Provide DATABASE_URL and RESTORE_DATABASE_URL for Supabase mode, then rerun pnpm test:db-ops; Docker remains optional."
      completedAt = (Get-Date).ToUniversalTime().ToString("o")
    }
    $result | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $resultPath
    Write-Output ($result | ConvertTo-Json -Depth 10)
    exit 0
  }
}

try {
  $backupArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $ProjectRoot "scripts/ops/backup-postgres.ps1"), "-ProjectRoot", $ProjectRoot, "-Mode", $Mode)
  if ($ConnectionString) { $backupArgs += @("-ConnectionString", $ConnectionString) }
  & powershell @backupArgs
  if ($LASTEXITCODE -ne 0) { throw "backup-postgres.ps1 failed" }
  $latest = Get-ChildItem (Join-Path $ProjectRoot ".runtime/backups") -Filter "full-*.sql" -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $latest) { throw "No SQL backup was produced" }

  $restoreArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $ProjectRoot "scripts/ops/restore-smoke.ps1"), "-ProjectRoot", $ProjectRoot, "-BackupPath", (Get-ProjectRelativePath $latest.FullName), "-Mode", $Mode)
  if ($ConnectionString) { $restoreArgs += @("-ConnectionString", $ConnectionString) }
  if ($RestoreConnectionString) { $restoreArgs += @("-RestoreConnectionString", $RestoreConnectionString) }
  & powershell @restoreArgs
  if ($LASTEXITCODE -ne 0) { throw "restore-smoke.ps1 failed" }

  $walArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $ProjectRoot "scripts/ops/check-wal-archive.ps1"), "-ProjectRoot", $ProjectRoot, "-Mode", $Mode)
  if ($ConnectionString) { $walArgs += @("-ConnectionString", $ConnectionString) }
  & powershell @walArgs
  if ($LASTEXITCODE -ne 0) { throw "check-wal-archive.ps1 failed" }

  $result = [ordered]@{ schemaVersion = "db-ops-acceptance-v2"; status = "PASS"; mode = $Mode; backup = $latest.Name; rpoTargetMinutes = 15; rtoTargetHours = 2; completedAt = (Get-Date).ToUniversalTime().ToString("o") }
} catch {
  $result = [ordered]@{ schemaVersion = "db-ops-acceptance-v2"; status = "FAIL"; mode = $Mode; error = $_.Exception.Message; rpoTargetMinutes = 15; rtoTargetHours = 2; completedAt = (Get-Date).ToUniversalTime().ToString("o") }
}
$result | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $resultPath
Write-Output ($result | ConvertTo-Json -Depth 10)
if ($result.status -eq "FAIL") { exit 1 }
