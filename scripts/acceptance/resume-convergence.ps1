param(
  [string]$ProjectRoot = (Get-Location).Path,
  [ValidateSet("fast","gate","full")] [string]$Mode = "full",
  [int]$MaxRounds = 5
)

. "$PSScriptRoot\lib.ps1"

$ProjectRoot = Get-ProjectRoot $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$latestDir = Join-Path $p.Docs "latest"
$handoff = Join-Path $latestDir "HANDOFF.md"
$runIdPath = Join-Path $latestDir "run-id.txt"
$summaryPath = Join-Path $latestDir "machine-summary.json"
$gapListPath = Join-Path $latestDir "gap-list.json"
$repairPlanPath = Join-Path $latestDir "repair-plan.md"
$nextActionPath = Join-Path $latestDir "next-agent-action.md"

foreach ($required in @($handoff, $runIdPath, $summaryPath, $gapListPath, $repairPlanPath, $nextActionPath)) {
  if (!(Test-Path -LiteralPath $required)) {
    Write-Host "ERROR: required resume file not found: $required"
    Write-Host "Cannot resume safely. Run init-harness for a new task, or restore docs/auto-execute/latest from the previous run."
    exit 1
  }
}

try { $summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json } catch {
  Write-Host "ERROR: machine-summary.json is not valid JSON. Cannot resume safely."
  exit 1
}
try { $gapList = Get-Content -LiteralPath $gapListPath -Raw | ConvertFrom-Json } catch { $gapList = $null }

$runId = (Get-Content -LiteralPath $runIdPath -Raw).Trim()
$verdict = if ($null -ne $summary -and ![string]::IsNullOrWhiteSpace([string]$summary.finalVerdict)) { Normalize-AEVerdict $summary.finalVerdict } else { "PENDING" }
$openGaps = @()
if ($null -ne $gapList -and $null -ne $gapList.gaps) {
  $openGaps = @($gapList.gaps) | Where-Object { $_.severity -in @("HARD_FAIL","IN_SCOPE_GAP") -and $_.status -ne "CLOSED" }
}

Write-Host "Resume current auto-execute run"
Write-Host "RunId: $runId"
Write-Host "FinalVerdict: $verdict"
Write-Host "Open HARD_FAIL/IN_SCOPE_GAP: $($openGaps.Count)"

switch ($verdict) {
  "PASS" {
    Write-Host "[PASS] Current run already passed. No resume needed."
    exit 0
  }
  "PASS_WITH_LIMITATION" {
    Write-Host "[PASS_WITH_LIMITATION] Current run completed with limitations. Review docs/auto-execute/latest/HANDOFF.md."
    exit 0
  }
  "PASS_NEEDS_MANUAL_UI_REVIEW" {
    Write-Host "[PASS_NEEDS_MANUAL_UI_REVIEW] Functional pass, UI manual review required."
    exit 0
  }
  "BLOCKED" {
    Write-Host "[BLOCKED] Current run is blocked. Review docs/auto-execute/latest/blockers.md."
    exit 4
  }
  default {
    Write-Host "[RESUME] Re-running convergence without ResetConvergence."
    $args = @(
      "-ExecutionPolicy", "Bypass",
      "-File", (Join-Path $PSScriptRoot "run-convergence.ps1"),
      "-ProjectRoot", $ProjectRoot,
      "-Mode", $Mode,
      "-MaxRounds", $MaxRounds
    )
    & powershell @args
    $exitCode = $LASTEXITCODE
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "write-handoff.ps1") -ProjectRoot $ProjectRoot -Reason "resume-convergence completed"
    exit $exitCode
  }
}
