param(
  [string]$ProjectRoot = (Get-Location).Path,
  [ValidateSet("fast","gate","full")] [string]$Mode = "gate",
  [int]$MaxRounds = 5,
  [switch]$ResetConvergence,
  [switch]$Strict
)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$previousOpenGaps = @()
try {
  $previousGapList = Get-Content -LiteralPath $p.GapListJson -Raw | ConvertFrom-Json
  if ($null -ne $previousGapList) {
    $previousOpenGaps = @($previousGapList.gaps) | Where-Object { $_.severity -in @("HARD_FAIL","IN_SCOPE_GAP") -and $_.status -ne "CLOSED" }
  }
} catch {}

if ($ResetConvergence) {
  Reset-ConvergenceState $ProjectRoot $MaxRounds
  $previousOpenGaps = @()
  Write-Host "Convergence state reset. Starting from round 1."
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "convergence reset"
}

try { $state = Get-Content -LiteralPath $p.ConvergenceState -Raw | ConvertFrom-Json } catch { $state = $null }
$previousRound = 0
if ($null -ne $state -and $null -ne $state.currentRound) { $previousRound = [int]$state.currentRound }

if ($previousRound -ge $MaxRounds) {
  @{
    status = "FAILED_TO_CONVERGE"
    currentRound = $previousRound
    maxRounds = $MaxRounds
    finalVerdict = "HARD_FAIL"
    updatedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.ConvergenceState
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-final-gate.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
  Write-Host "FAIL: Acceptance did not converge within max rounds."
  exit 1
}

$round = $previousRound + 1
Write-Host "=== Acceptance Convergence Round $round/$MaxRounds ==="
@{
  status = "RUNNING"
  currentRound = $round
  maxRounds = $MaxRounds
  updatedAt = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.ConvergenceState

Reset-GapList $ProjectRoot $round
$p.Verification | ForEach-Object { "# Verification Results`n`nRound: $round`n" | Set-Content -Encoding UTF8 $_ }
$p.Blockers | ForEach-Object { "# Blockers`n`nRound: $round`n" | Set-Content -Encoding UTF8 $_ }
Write-LaneResult $ProjectRoot "gap-repair" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $p.GapListJson)) @() @("No repair handoff has been generated for this round yet.")
Write-LaneResult $ProjectRoot "acceptance-compare" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $p.GapListJson)) @() @("Acceptance comparison will be regenerated later in this round.")
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "convergence round $round started"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-all.ps1") -ProjectRoot $ProjectRoot -Mode $Mode -SkipCompare -SkipFinalGate
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-compare-requirements.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "requirements compare completed"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-compare-ui.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "ui compare completed"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-acceptance-compare.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "acceptance compare completed"

try { $gapList = Get-Content -LiteralPath $p.GapListJson -Raw | ConvertFrom-Json } catch { $gapList = $null }
$hardGaps = @()
if ($null -ne $gapList) {
  $hardGaps = @($gapList.gaps) | Where-Object { $_.severity -in @("HARD_FAIL","IN_SCOPE_GAP") -and $_.status -ne "CLOSED" }
}

$currentOpenIds = @($hardGaps | ForEach-Object { $_.id })
$closedGaps = @($previousOpenGaps) | Where-Object { $_.id -notin $currentOpenIds }
Add-GapClosureLog $ProjectRoot $closedGaps $round

$roundMd = Join-Path $p.ConvergenceRounds "round-$('{0:D3}' -f $round).md"
@(
  "# Convergence Round $round",
  "",
  "Generated: $(Get-Date)",
  "",
  "- Hard/in-scope gaps: $($hardGaps.Count)",
  "- Gap list: $(Get-RelativeEvidencePath $ProjectRoot $p.GapListJson)"
) | Set-Content -Encoding UTF8 $roundMd
Add-EvidenceItem $ProjectRoot "other" $roundMd "convergence round $round"

if ($hardGaps.Count -eq 0) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-final-gate.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
  $finalExit = $LASTEXITCODE
  try {
    $summary = Get-Content -LiteralPath $p.MachineSummary -Raw | ConvertFrom-Json
    $finalVerdict = Normalize-AEVerdict $summary.finalVerdict
  } catch {
    $finalVerdict = "HARD_FAIL"
    $finalExit = 1
  }
  Write-Host "$finalVerdict`: Acceptance convergence reached final gate."
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "final gate completed"
  exit $(if ($null -ne $finalExit) { $finalExit } else { Get-AEExitCode $finalVerdict })
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-gap-repair.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
@{
  status = "REPAIR_REQUIRED"
  currentRound = $round
  maxRounds = $MaxRounds
  lastGapCount = $hardGaps.Count
  repairPlan = Get-RelativeEvidencePath $ProjectRoot $p.RepairPlan
  nextAgentAction = Get-RelativeEvidencePath $ProjectRoot $p.NextAgentAction
  finalVerdict = "PENDING"
  updatedAt = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.ConvergenceState
Set-MachineSummaryRepairRequired $ProjectRoot $hardGaps.Count $p.RepairPlan $p.NextAgentAction
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "repair required"
Write-Host "REPAIR_REQUIRED: Agent must edit implementation/tests/evidence using repair-plan.md, then run convergence again."
exit 2
