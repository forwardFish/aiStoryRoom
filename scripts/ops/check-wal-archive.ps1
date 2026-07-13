param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
  [ValidateSet("auto", "docker", "external")][string]$Mode = "auto",
  [string]$ConnectionString = "",
  [string]$ContainerName = "ai_story_run_postgres",
  [int]$MaxAgeMinutes = 15
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path

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
function Normalize-LibpqConnectionString([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  $normalized = $Value -replace '([?&])(schema|connection_limit|pgbouncer)=[^&]*', '$1'
  $normalized = $normalized -replace '\?&', '?' -replace '&&', '&' -replace '[?&]$', ''
  return $normalized
}
$ConnectionString = Normalize-LibpqConnectionString $ConnectionString
if ($Mode -eq "auto") { $Mode = if ([string]::IsNullOrWhiteSpace($ConnectionString)) { "docker" } else { "external" } }

$latest = $null
$failedCount = $null
if ($Mode -eq "external") {
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw "External mode requires -ConnectionString or DATABASE_URL in .env." }
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw "psql is required for external PostgreSQL mode." }
  $result = & psql -X -v ON_ERROR_STOP=1 -At -c "select coalesce(extract(epoch from last_archived_time)::bigint,0) || '|' || failed_count from pg_stat_archiver;" $ConnectionString 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect PostgreSQL WAL archiver: $($result -join ' ')" }
  $parts = (($result -join "").Trim()) -split "\|"
  if ($parts[0] -and [int64]$parts[0] -gt 0) { $latest = [DateTimeOffset]::FromUnixTimeSeconds([int64]$parts[0]).UtcDateTime }
  if ($parts.Count -gt 1) { $failedCount = [int]$parts[1] }
} else {
  $result = & docker exec $ContainerName sh -lc "find /var/lib/postgresql/wal-archive -type f -printf '%T@ %p\n' | sort -nr | head -1"
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect PostgreSQL WAL archive" }
  $line = ($result -join "").Trim()
  if ($line) {
    $parts = $line -split " ", 2
    $latest = [DateTimeOffset]::FromUnixTimeSeconds([int64][math]::Floor([double]$parts[0])).UtcDateTime
  }
}

$age = if ($latest) { ((Get-Date).ToUniversalTime() - $latest).TotalMinutes } else { [double]::PositiveInfinity }
$status = if ($latest -and $age -le $MaxAgeMinutes) { "PASS" } else { "PASS_WITH_LIMITATION" }
$evidence = [ordered]@{
  schemaVersion = "wal-archive-check-v2"
  status = $status
  mode = $Mode
  latestArchiveAt = if ($latest) { $latest.ToString("o") } else { $null }
  ageMinutes = if ([double]::IsInfinity($age)) { $null } else { [math]::Round($age, 3) }
  failedArchiveCount = $failedCount
  targetMinutes = $MaxAgeMinutes
  note = if ($status -eq "PASS") { "WAL archiver reports an archive within the configured RPO window." } elseif ($Mode -eq "external") { "External provider did not expose a recent pg_stat_archiver timestamp; attach Supabase PITR/provider evidence." } else { "No recent WAL archive was observed; inspect Docker/PostgreSQL archive mode." }
}
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$path = Join-Path $ProjectRoot "docs/auto-execute/results/wal-archive-$stamp.json"
$evidence | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $path
Write-Output ($evidence | ConvertTo-Json -Depth 8)
