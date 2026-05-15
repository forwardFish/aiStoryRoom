param(
  [string]$ProjectRoot = (Get-Location).Path,
  [ValidateSet("fast","gate","full")] [string]$Mode = "fast",
  [switch]$AllowCommit,
  [switch]$AllowPush,
  [switch]$SkipCompare,
  [switch]$SkipFinalGate
)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
Update-State $ProjectRoot "run-all" "running" "Mode=$Mode"
Write-Host "auto-execute run-all | Mode=$Mode | ProjectRoot=$ProjectRoot"

$configAllowCommit = (Get-HarnessConfigValue $ProjectRoot "safety" "allowCommit" "false") -eq "true"
$configAllowPush = (Get-HarnessConfigValue $ProjectRoot "safety" "allowPush" "false") -eq "true"
if ($AllowPush -and -not $AllowCommit) { throw "AllowPush requires AllowCommit." }
if ($AllowCommit -and -not $configAllowCommit) { throw "AllowCommit requested but harness.yml safety.allowCommit is false." }
if ($AllowPush -and -not $configAllowPush) { throw "AllowPush requested but harness.yml safety.allowPush is false." }

$laneStages = @(
  "run-secret-guard.ps1",
  "collect-env.ps1",
  "run-verifier-dependencies.ps1",
  "collect-git-status.ps1",
  "run-adapter-detect.ps1",
  "run-requirements.ps1",
  "plan-fullstack-delivery.ps1",
  "run-scope-classification.ps1",
  "run-architecture-guard.ps1",
  "run-backend.ps1",
  "run-db-e2e.ps1",
  "run-frontend.ps1",
  "run-contract.ps1",
  "run-api-smoke.ps1",
  "run-deepseek-live-smoke.ps1",
  "run-web-cabin-smoke.ps1",
  "run-web-cabin-visual-diff.ps1",
  "run-visual-smoke.ps1",
  "run-basic-visual-diff.ps1",
  "run-full-flow-smoke.ps1",
  "summarize-errors.ps1"
)
$compareStages = @(
  "run-compare-requirements.ps1",
  "run-compare-ui.ps1",
  "run-acceptance-compare.ps1"
)
$reviewStages = @(
  "run-code-review.ps1"
)
$stages = @()
$stages += $laneStages
if (-not $SkipCompare) { $stages += $compareStages }
$stages += $reviewStages

foreach ($s in $stages) {
  $path = Join-Path $PSScriptRoot $s
  if (Test-Path $path) {
    try { & powershell -ExecutionPolicy Bypass -File $path -ProjectRoot $ProjectRoot -Mode $Mode }
    catch { Add-VerificationResult $ProjectRoot $s "HARD_FAIL" $_.Exception.Message ""; Write-Host "ERROR: $s failed" }
  } else { Add-Blocker $ProjectRoot $s "HARD_FAIL" "Missing stage script" }
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "verifier lane $s completed"
}

$p = Get-AEPaths $ProjectRoot
$report = $p.FinalReport
Ensure-Dir (Split-Path $report)
@(
  "# AUTO EXECUTE DELIVERY REPORT",
  "",
  "Generated: $(Get-Date)",
  "",
  "## Summary",
  "",
  "- Project root: $ProjectRoot",
  "- Mode: $Mode",
  "- Verification results: docs/auto-execute/verification-results.md",
  "- Blockers: docs/auto-execute/blockers.md",
  "- Machine summary: docs/auto-execute/machine-summary.json",
  "- Evidence manifest: docs/auto-execute/evidence-manifest.json",
  "- Lane results: docs/auto-execute/results",
  "- Logs: docs/auto-execute/logs",
  "- Screenshots: docs/auto-execute/screenshots",
  "- Commit/push: not performed by default",
  "",
  "## Next command",
  "",
  '```powershell',
  'powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\select-next-feature.ps1',
  '```'
) | Set-Content -Encoding UTF8 $report

Add-EvidenceItem $ProjectRoot "final" $report "final delivery report"
try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-report-integrity.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
} catch {
  Add-VerificationResult $ProjectRoot "run-report-integrity.ps1" "HARD_FAIL" $_.Exception.Message ""
  Write-Host "ERROR: run-report-integrity.ps1 failed"
}
$finalVerdict = "PASS_WITH_LIMITATION"
$exitCode = 3
if (-not $SkipFinalGate) {
  try {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-final-gate.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
    $exitCode = $LASTEXITCODE
  } catch {
    Add-VerificationResult $ProjectRoot "run-final-gate.ps1" "HARD_FAIL" $_.Exception.Message ""
    Write-Host "ERROR: run-final-gate.ps1 failed"
    $exitCode = 1
  }
  try {
    $summary = Get-Content -LiteralPath $p.MachineSummary -Raw | ConvertFrom-Json
    $finalVerdict = Normalize-AEVerdict $summary.finalVerdict
    $exitCode = Get-AEExitCode $finalVerdict
  } catch {
    $finalVerdict = "HARD_FAIL"
    $exitCode = 1
  }
} else {
  Update-MachineSummary $ProjectRoot
  try {
    $summary = Get-Content -LiteralPath $p.MachineSummary -Raw | ConvertFrom-Json
    $finalVerdict = Normalize-AEVerdict $summary.finalVerdict
    if ($finalVerdict -eq "HARD_FAIL") { $exitCode = 1 } else { $exitCode = 0 }
  } catch {
    $finalVerdict = "HARD_FAIL"
    $exitCode = 1
  }
}
Update-State $ProjectRoot "run-all" $finalVerdict "Review docs/AUTO_EXECUTE_DELIVERY_REPORT.md and docs/auto-execute/machine-summary.json"
Add-VerificationResult $ProjectRoot "run-all" $finalVerdict "All available stages attempted; final verdict: $finalVerdict" $report
Write-LaneResult $ProjectRoot "run-all" $finalVerdict @() @((Get-RelativeEvidencePath $ProjectRoot $report),(Get-RelativeEvidencePath $ProjectRoot (Get-AEPaths $ProjectRoot).MachineSummary)) @() @()
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "run-all completed"
Write-Host "[$finalVerdict] run-all. Report: $report"
exit $exitCode
