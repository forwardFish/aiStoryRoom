param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
  [string]$OutputDir = ".runtime/backups",
  [ValidateSet("auto", "docker", "external")][string]$Mode = "auto",
  [string]$ConnectionString = "",
  [string]$ContainerName = "ai_story_run_postgres",
  [string]$Database = "ai_story_run",
  [string]$User = "ai_story",
  [int]$RetentionDays = 30
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
function Normalize-LibpqConnectionString([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  $normalized = $Value -replace '([?&])(schema|connection_limit|pgbouncer)=[^&]*', '$1'
  $normalized = $normalized -replace '\?&', '?' -replace '&&', '&' -replace '[?&]$', ''
  return $normalized
}
$ConnectionString = Normalize-LibpqConnectionString $ConnectionString
if ($Mode -eq "auto") { $Mode = if ([string]::IsNullOrWhiteSpace($ConnectionString)) { "docker" } else { "external" } }

$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $OutputDir))
if (-not $resolvedOutput.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Backup output must remain inside the project root."
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

function Invoke-DockerText([string[]]$Arguments) {
  $result = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker command failed: docker $($Arguments -join ' ')" }
  return ($result -join [Environment]::NewLine)
}

function Invoke-ExternalText([string]$Sql) {
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw "psql is required for external PostgreSQL mode." }
  $result = & psql -X -v ON_ERROR_STOP=1 -At -c $Sql $ConnectionString 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $($result -join ' ')" }
  return ($result -join [Environment]::NewLine).Trim()
}

function Invoke-ExternalDump([string]$Path) {
  if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { throw "pg_dump is required for external PostgreSQL mode." }
  $errorPath = "$Path.err"
  & pg_dump --no-owner --no-privileges --format=plain $ConnectionString 2> $errorPath | Set-Content -LiteralPath $Path -Encoding UTF8
  if ($LASTEXITCODE -ne 0) {
    $message = if (Test-Path -LiteralPath $errorPath) { Get-Content -Raw -LiteralPath $errorPath } else { "unknown pg_dump error" }
    Remove-Item -Force -ErrorAction SilentlyContinue $errorPath
    throw "pg_dump failed: $message"
  }
  Remove-Item -Force -ErrorAction SilentlyContinue $errorPath
}

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$backupPath = Join-Path $resolvedOutput "full-$stamp.sql"
$manifestPath = Join-Path $ProjectRoot "docs/auto-execute/results/db-backup-$stamp.json"

if ($Mode -eq "external") {
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw "External mode requires -ConnectionString or DATABASE_URL in .env." }
  Invoke-ExternalDump $backupPath
  $runCount = [int](Invoke-ExternalText 'select count(*) from "StoryRun";')
  $eventCount = [int](Invoke-ExternalText 'select count(*) from "StoryEvent";')
  $wal = Invoke-ExternalText "select coalesce(extract(epoch from last_archived_time)::bigint,0) || '|' || archived_count || '|' || failed_count from pg_stat_archiver;"
  $walParts = $wal -split "\|"
  $walLatest = if ($walParts[0] -and [int64]$walParts[0] -gt 0) { [DateTimeOffset]::FromUnixTimeSeconds([int64]$walParts[0]).UtcDateTime.ToString("o") } else { $null }
  $walArchivedCount = if ($walParts.Count -gt 1) { [int]$walParts[1] } else { $null }
  $walFailedCount = if ($walParts.Count -gt 2) { [int]$walParts[2] } else { $null }
  $walMode = "postgres-pg_stat_archiver"
} else {
  $dump = Invoke-DockerText @("exec", $ContainerName, "pg_dump", "-U", $User, "-d", $Database, "--no-owner", "--no-privileges", "--format=plain")
  [System.IO.File]::WriteAllText($backupPath, $dump, [System.Text.UTF8Encoding]::new($false))
  $runCount = [int](Invoke-DockerText @("exec", $ContainerName, "psql", "-U", $User, "-d", $Database, "-At", "-c", 'select count(*) from "StoryRun";')).Trim()
  $eventCount = [int](Invoke-DockerText @("exec", $ContainerName, "psql", "-U", $User, "-d", $Database, "-At", "-c", 'select count(*) from "StoryEvent";')).Trim()
  $walCount = [int](Invoke-DockerText @("exec", $ContainerName, "sh", "-lc", "find /var/lib/postgresql/wal-archive -type f | wc -l")).Trim()
  $walMode = "docker-wal-archive-volume"
  $walLatest = $null
  $walArchivedCount = $walCount
  $walFailedCount = $null
}

$cutoff = (Get-Date).ToUniversalTime().AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $resolvedOutput -File -Filter "full-*.sql" |
  Where-Object { $_.LastWriteTimeUtc -lt $cutoff } |
  Remove-Item -Force

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash
$manifest = [ordered]@{
  schemaVersion = "db-backup-v2"
  status = "PASS"
  mode = $Mode
  backupCompletedAt = (Get-Date).ToUniversalTime().ToString("o")
  backupPath = Get-ProjectRelativePath $backupPath
  sha256 = $hash
  database = $Database
  storyRunCount = $runCount
  storyEventCount = $eventCount
  walMode = $walMode
  latestArchivedAt = $walLatest
  walArchivedCount = $walArchivedCount
  walFailedCount = $walFailedCount
  retentionDays = $RetentionDays
  rpoTargetMinutes = 15
  rtoTargetHours = 2
  note = if ($Mode -eq "external") { "External PostgreSQL/Supabase mode; provider PITR evidence remains required for managed WAL retention." } else { "Docker PostgreSQL WAL archive volume mode." }
}
New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath) | Out-Null
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $manifestPath
Write-Output ($manifest | ConvertTo-Json -Depth 8)
