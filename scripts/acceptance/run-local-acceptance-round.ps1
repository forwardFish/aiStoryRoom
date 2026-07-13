param(
  [Parameter(Mandatory=$true)][int]$Round,
  [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = "Continue"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$log = Join-Path $ProjectRoot "docs/auto-execute/logs/local-acceptance-round-$Round.log"
$resultPath = Join-Path $ProjectRoot "docs/auto-execute/results/local-acceptance-round-$Round.json"
New-Item -ItemType Directory -Force -Path (Split-Path $log), (Split-Path $resultPath) | Out-Null
$started = Get-Date
Push-Location $ProjectRoot
try {
  & pnpm test:acceptance *>&1 | Tee-Object -FilePath $log
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
$elapsed = ((Get-Date) - $started).TotalSeconds
$result = [ordered]@{
  schemaVersion = "local-acceptance-round-v1"
  round = $Round
  status = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
  exitCode = $exitCode
  startedAt = $started.ToUniversalTime().ToString("o")
  completedAt = (Get-Date).ToUniversalTime().ToString("o")
  elapsedSeconds = [math]::Round($elapsed, 3)
  command = "pnpm test:acceptance"
  log = "docs/auto-execute/logs/local-acceptance-round-$Round.log"
  included = @("config", "causal-api-web", "maneuver", "paths", "security-projection", "concurrency", "ai-failure", "provider-retry", "continuous-20-runs", "storage-failure-recovery", "ops-contract")
}
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $resultPath
Write-Output ($result | ConvertTo-Json -Depth 8)
exit $exitCode
