param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Docs "FULL_FLOW_ACCEPTANCE.md"
$e2eLog = Join-Path $p.Logs "story-e2e.log"
$previewOut = Join-Path $p.Logs "story-e2e-preview-api.out.log"
$previewErr = Join-Path $p.Logs "story-e2e-preview-api.err.log"

function Stop-Tree($Proc) {
  if ($null -ne $Proc -and -not $Proc.HasExited) {
    try { & taskkill.exe /PID $Proc.Id /T /F | Out-Null } catch { try { Stop-Process -Id $Proc.Id -Force } catch {} }
  }
}
function Wait-Http($Url, $Seconds = 30) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    try { return Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 } catch { $last = $_.Exception.Message; Start-Sleep -Milliseconds 500 }
  }
  throw "Timed out waiting for $Url. Last error: $last"
}

"# Full Flow Acceptance`n`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $out
$preview = $null
$blockers = @()
$evidence = @((Get-RelativeEvidencePath $ProjectRoot $out))
$commands = @()
try {
  $preview = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev:preview-api" -WorkingDirectory $ProjectRoot -RedirectStandardOutput $previewOut -RedirectStandardError $previewErr -PassThru -WindowStyle Hidden
  Wait-Http "http://localhost:3001/api/health" 30 | Out-Null
  Push-Location $ProjectRoot
  try {
    $env:API_BASE = "http://localhost:3001/api"
    & pnpm.cmd test:story:e2e *>&1 | Tee-Object -FilePath $e2eLog
    $e2eCode = $LASTEXITCODE
  } finally {
    Remove-Item Env:\API_BASE -ErrorAction SilentlyContinue
    Pop-Location
  }
  $commands += @{ command = "pnpm test:story:e2e"; status = $(if ($e2eCode -eq 0) { "PASS" } else { "HARD_FAIL" }); log = Get-RelativeEvidencePath $ProjectRoot $e2eLog }
  $evidence += Get-RelativeEvidencePath $ProjectRoot $e2eLog
  if ($e2eCode -ne 0) { throw "pnpm test:story:e2e failed with exit code $e2eCode" }

  $latestReport = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "scripts\test-reports") -Filter "story-e2e-*.json" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latestReport) {
    $evidence += Get-RelativeEvidencePath $ProjectRoot $latestReport.FullName
    Add-Content -Encoding UTF8 $out "- Story E2E report: $(Get-RelativeEvidencePath $ProjectRoot $latestReport.FullName)"
  }
  Add-Content -Encoding UTF8 $out "- Story E2E: PASS"
} catch {
  $blockers += $_.Exception.Message
  Add-Content -Encoding UTF8 $out "- Story E2E: HARD_FAIL - $($_.Exception.Message)"
} finally {
  Stop-Tree $preview
}

try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-web-cabin-smoke.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
  $webResultPath = Join-Path $p.Results "web-cabin-smoke.json"
  $evidence += "docs\auto-execute\summaries\web-cabin-smoke.md"
  $evidence += "docs\auto-execute\screenshots\web-cabin-smoke.png"
  $evidence += "docs\auto-execute\logs\web-cabin-browser-summary.json"
  if (Test-Path -LiteralPath $webResultPath) {
    try {
      $webResult = Get-Content -LiteralPath $webResultPath -Raw | ConvertFrom-Json
      if ($webResult.status -notin @("PASS","PASS_WITH_LIMITATION")) { $blockers += "web-cabin-smoke status is $($webResult.status)" }
    } catch {
      $blockers += "web-cabin-smoke result could not be parsed"
    }
  }
} catch {
  $blockers += "web-cabin-smoke failed: $($_.Exception.Message)"
}

$status = if ($blockers.Count -eq 0) { "PASS" } else { "HARD_FAIL" }
Add-VerificationResult $ProjectRoot "full-flow-smoke" $status $(if ($status -eq "PASS") { "Story E2E and web cabin smoke passed" } else { $blockers -join "; " }) $out
Write-LaneResult $ProjectRoot "integration" $status $commands $evidence $blockers @("Repair story E2E or web cabin smoke before final acceptance.")
Write-Host "[$status] full-flow-smoke"
