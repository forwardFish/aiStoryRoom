param([string]$ProjectRoot = (Get-Location).Path)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

try { $summary = Get-Content -LiteralPath $p.MachineSummary -Raw | ConvertFrom-Json } catch { $summary = $null }
try { $state = Get-Content -LiteralPath $p.ConvergenceState -Raw | ConvertFrom-Json } catch { $state = $null }
try { $gapList = Get-Content -LiteralPath $p.GapListJson -Raw | ConvertFrom-Json } catch { $gapList = $null }

$verdict = if ($null -ne $summary -and $summary.finalVerdict) { Normalize-AEVerdict $summary.finalVerdict } else { "PENDING" }
$currentRound = if ($null -ne $state -and $null -ne $state.currentRound) { [int]$state.currentRound } else { 0 }
$maxRounds = if ($null -ne $state -and $null -ne $state.maxRounds) { [int]$state.maxRounds } else { 5 }
$openHard = @()
$openUi = @()
if ($null -ne $gapList) {
  $openHard = @($gapList.gaps) | Where-Object { $_.severity -in @("HARD_FAIL","IN_SCOPE_GAP") -and $_.status -ne "CLOSED" }
  $openUi = @($gapList.gaps) | Where-Object { $_.type -eq "ui" -and $_.status -ne "CLOSED" }
}

$documented = if ($null -ne $summary) { @($summary.documentedBlockers) } else { @() }
$manual = if ($null -ne $summary) { @($summary.manualReviewRequired) } else { @() }
$lastRun = if ($null -ne $summary -and $summary.updatedAt) { $summary.updatedAt } elseif ($null -ne $state -and $state.updatedAt) { $state.updatedAt } else { "" }
$nextAction = if ($null -ne $summary -and $summary.nextRecommendedAction) { $summary.nextRecommendedAction } else { "" }

Write-Host "Final verdict: $verdict"
Write-Host "Current round: $currentRound/$maxRounds"
Write-Host "Open hard gaps: $(@($openHard).Count)"
Write-Host "Open UI gaps: $(@($openUi).Count)"
Write-Host "Documented blockers: $(@($documented).Count)"
Write-Host "Manual review items: $(@($manual).Count)"
Write-Host "Next action file: $(Get-RelativeEvidencePath $ProjectRoot $p.NextAgentAction)"
Write-Host "Repair plan: $(Get-RelativeEvidencePath $ProjectRoot $p.RepairPlan)"
Write-Host "Last run: $lastRun"
Write-Host "Next action: $nextAction"

if ($verdict -eq "REPAIR_REQUIRED") {
  Write-Host "Recommended command: read docs/auto-execute/next-agent-action.md, edit implementation/tests/evidence, then run powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-convergence.ps1 -Mode gate -MaxRounds 5"
} elseif ($verdict -in @("PASS","PASS_WITH_LIMITATION")) {
  Write-Host "Recommended command: review docs/auto-execute/final-convergence-report.md and docs/AUTO_EXECUTE_DELIVERY_REPORT.md"
} else {
  Write-Host "Recommended command: powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-convergence.ps1 -Mode gate -MaxRounds 5"
}

exit (Get-AEExitCode $verdict)
