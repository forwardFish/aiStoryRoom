param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
  [ValidateSet("auto", "docker", "external")][string]$Mode = "auto",
  [string]$ConnectionString = "",
  [string]$RestoreConnectionString = "",
  [string]$ContainerName = "ai_story_run_postgres",
  [string]$User = "ai_story",
  [switch]$KeepRestoreDatabase
)

$ErrorActionPreference = "Stop"
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
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($ConnectionString)) { $ConnectionString = Get-ProjectEnvValue "DATABASE_URL" }
if ([string]::IsNullOrWhiteSpace($RestoreConnectionString)) { $RestoreConnectionString = Get-ProjectEnvValue "RESTORE_DATABASE_URL" }
function Normalize-LibpqConnectionString([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  $normalized = $Value -replace '([?&])(schema|connection_limit|pgbouncer)=[^&]*', '$1'
  $normalized = $normalized -replace '\?&', '?' -replace '&&', '&' -replace '[?&]$', ''
  return $normalized
}
$ConnectionString = Normalize-LibpqConnectionString $ConnectionString
$RestoreConnectionString = Normalize-LibpqConnectionString $RestoreConnectionString
if ($Mode -eq "auto") { $Mode = if ([string]::IsNullOrWhiteSpace($ConnectionString)) { "docker" } else { "external" } }

$resolvedBackup = (Resolve-Path (Join-Path $ProjectRoot $BackupPath)).Path
if (-not $resolvedBackup.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Restore input must remain inside the project root."
}

function Invoke-Docker([string[]]$Arguments) {
  $result = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker command failed: docker $($Arguments -join ' ')" }
  return ($result -join [Environment]::NewLine)
}

function Invoke-External([string]$TargetConnectionString, [string[]]$Arguments) {
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw "psql is required for external PostgreSQL mode." }
  $result = & psql -X -v ON_ERROR_STOP=1 @Arguments $TargetConnectionString 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $($result -join ' ')" }
  return ($result -join [Environment]::NewLine).Trim()
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$started = Get-Date
$restoreDb = $null
try {
  if ($Mode -eq "external") {
    if ([string]::IsNullOrWhiteSpace($RestoreConnectionString)) {
      throw "External restore requires a fresh isolated RESTORE_DATABASE_URL; never restore into the production Supabase database."
    }
    Invoke-External $RestoreConnectionString @("-f", $resolvedBackup) | Out-Null
    $runCount = [int](Invoke-External $RestoreConnectionString @("-At", "-c", 'select count(*) from "StoryRun";'))
    $eventCount = [int](Invoke-External $RestoreConnectionString @("-At", "-c", 'select count(*) from "StoryEvent";'))
    $restoreTarget = "external-isolated-database"
  } else {
    $restoreDb = "ai_story_restore_$($stamp.Replace('T','').Replace('Z','').Replace('-','').Replace(':',''))"
    Invoke-Docker @("exec", $ContainerName, "createdb", "-U", $User, $restoreDb) | Out-Null
    $sql = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedBackup
    $sql | & docker exec -i $ContainerName psql -U $User -d $restoreDb -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw "restored SQL rejected by PostgreSQL" }
    $runCount = [int](Invoke-Docker @("exec", $ContainerName, "psql", "-U", $User, "-d", $restoreDb, "-At", "-c", 'select count(*) from "StoryRun";')).Trim()
    $eventCount = [int](Invoke-Docker @("exec", $ContainerName, "psql", "-U", $User, "-d", $restoreDb, "-At", "-c", 'select count(*) from "StoryEvent";')).Trim()
    $restoreTarget = $restoreDb
  }
  $elapsed = ((Get-Date) - $started).TotalSeconds
  $evidence = [ordered]@{
    schemaVersion = "db-restore-smoke-v2"
    status = "PASS"
    mode = $Mode
    backupPath = Get-ProjectRelativePath $resolvedBackup
    restoreDatabase = $restoreTarget
    restoredStoryRunCount = $runCount
    restoredStoryEventCount = $eventCount
    rtoSeconds = [math]::Round($elapsed, 3)
    rtoTargetSeconds = 7200
    rtoWithinTarget = ($elapsed -le 7200)
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $evidencePath = Join-Path $ProjectRoot "docs/auto-execute/results/db-restore-smoke-$stamp.json"
  $evidence | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $evidencePath
  Write-Output ($evidence | ConvertTo-Json -Depth 8)
} finally {
  if ($Mode -eq "docker" -and -not $KeepRestoreDatabase -and $restoreDb) {
    try { Invoke-Docker @("exec", $ContainerName, "dropdb", "-U", $User, "--if-exists", $restoreDb) | Out-Null } catch { }
  }
}
