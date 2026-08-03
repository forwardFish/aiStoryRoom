param([string]$StatePath = "")

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if ([string]::IsNullOrWhiteSpace($StatePath)) {
  $candidates = @()
  $evidenceRoot = Join-Path $projectRoot "docs\auto-execute\evidence\openovel-multiplayer"
  foreach ($attemptDir in Get-ChildItem -LiteralPath $evidenceRoot -Directory) {
    $testResults = Join-Path $attemptDir.FullName "test-results"
    if (-not (Test-Path -LiteralPath $testResults)) { continue }
    foreach ($runDir in Get-ChildItem -LiteralPath $testResults -Directory -Filter "openovel-db-three-role-*") {
      $stackPath = Join-Path $runDir.FullName "m11-live\stack.json"
      if (Test-Path -LiteralPath $stackPath) { $candidates += Get-Item -LiteralPath $stackPath }
    }
  }
  $candidate = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $candidate) { throw "No M11 stack state found" }
  $StatePath = $candidate.FullName
}
$state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
foreach ($name in @("web", "api", "runtime")) {
  $pidValue = [int]$state.$name.pid
  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($process) { Stop-Process -Id $pidValue -Force; $process.WaitForExit(5000) | Out-Null }
}
[ordered]@{ status = "STOPPED"; statePath = [System.IO.Path]::GetFullPath($StatePath); stoppedAt = (Get-Date).ToString("o") } | ConvertTo-Json
