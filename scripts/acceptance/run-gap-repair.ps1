param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
try { $gapList = Get-Content -LiteralPath $p.GapListJson -Raw | ConvertFrom-Json } catch { $gapList = $null }
$open = @()
if ($null -ne $gapList) {
  $open = @($gapList.gaps) | Where-Object { $_.severity -in @("HARD_FAIL","IN_SCOPE_GAP") -and $_.status -ne "CLOSED" }
}
$repairDoc = Join-Path $p.Docs "08-repair-log.md"
$repairPlan = $p.RepairPlan
$nextAgentAction = $p.NextAgentAction
Add-Content -Encoding UTF8 $repairDoc "`n## Gap repair planning $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"
@(
  "# Repair Plan",
  "",
  "Generated: $(Get-Date)",
  "",
  "Agent must edit implementation, tests, or evidence for these gaps before the next convergence run.",
  ""
) | Set-Content -Encoding UTF8 $repairPlan
$openCount = @($open).Count
if ($openCount -eq 0) {
  Add-Content -Encoding UTF8 $repairDoc "- No hard/in-scope gaps require repair.`n"
  Add-Content -Encoding UTF8 $repairPlan "- No hard/in-scope gaps require repair."
  "# Next Agent Action`n`nNo repair action is pending.`n" | Set-Content -Encoding UTF8 $nextAgentAction
  Write-LaneResult $ProjectRoot "gap-repair" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $repairDoc),(Get-RelativeEvidencePath $ProjectRoot $repairPlan),(Get-RelativeEvidencePath $ProjectRoot $nextAgentAction)) @() @()
  Add-VerificationResult $ProjectRoot "gap-repair" "PASS" "No repairable hard gaps" $repairDoc
  Write-Host "[PASS] gap-repair"
  exit 0
}
@(
  "# Next Agent Action",
  "",
  "Generated: $(Get-Date)",
  "",
  "Do not run convergence again before making code, test, or evidence changes.",
  "",
  "## Repair These Gaps First",
  ""
) | Set-Content -Encoding UTF8 $nextAgentAction
foreach ($gap in $open) {
  $line = "- $($gap.id): $($gap.repairTarget)"
  Add-Content -Path $repairDoc -Encoding UTF8 -Value $line
  Add-Content -Path $repairPlan -Encoding UTF8 -Value @("## $($gap.id)", "", "- Type: $($gap.type)", "- Severity: $($gap.severity)", "- Source: $($gap.source)", "- Problem: $($gap.description)", "- Repair target: $($gap.repairTarget)", "")
  Add-Content -Path $nextAgentAction -Encoding UTF8 -Value @("- $($gap.id): $($gap.description)", "  - Repair target: $($gap.repairTarget)", "  - Source: $($gap.source)")
  Update-RepairAttempt $ProjectRoot $gap.id "RETRYING" $gap.description
}
Add-Content -Path $nextAgentAction -Encoding UTF8 -Value @(
  "",
  "## Allowed Work",
  "",
  "- Modify implementation files required to close the listed gaps.",
  "- Modify or add tests that prove the intended PRD/UI behavior.",
  "- Capture or attach truthful evidence such as logs, screenshots, API results, or visual diffs.",
  "- Update requirement-target.json or ui-target.json only when it reflects actual implementation and evidence.",
  "",
  "## Required Rerun",
  "",
  "After repairs, run:",
  "",
  "```powershell",
  "powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-convergence.ps1 -Mode $Mode -MaxRounds 5",
  "```",
  "",
  "## Prohibited",
  "",
  "- Do not delete or weaken valid tests to force a pass.",
  "- Do not fabricate screenshots, logs, visual diffs, or evidence.",
  "- Do not mark requirements or UI screens PASS unless the evidence exists.",
  "- Do not rerun convergence repeatedly without changing implementation, tests, or evidence."
)
Write-LaneResult $ProjectRoot "gap-repair" "IN_SCOPE_GAP" @() @((Get-RelativeEvidencePath $ProjectRoot $repairDoc),(Get-RelativeEvidencePath $ProjectRoot $repairPlan),(Get-RelativeEvidencePath $ProjectRoot $nextAgentAction),(Get-RelativeEvidencePath $ProjectRoot $p.GapListJson)) $open @("Agent must read next-agent-action.md, edit implementation/evidence for the listed gaps, then rerun convergence.")
Add-VerificationResult $ProjectRoot "gap-repair" "IN_SCOPE_GAP" "$openCount gap(s) require implementation repair" $repairPlan
Write-Host "[IN_SCOPE_GAP] gap-repair: $openCount gap(s); repair plan written"
