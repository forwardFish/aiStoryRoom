param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$round = Get-CurrentConvergenceRound $ProjectRoot
if ($round -le 1) { Reset-GapList $ProjectRoot $round }

try {
  $rawTarget = [System.IO.File]::ReadAllText($p.RequirementTarget, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
  $target = $rawTarget | ConvertFrom-Json
} catch {
  $target = $null
  Write-Host "requirement-target parse error: $($_.Exception.Message)"
}
$gaps = 0
$hasLimitations = $false
if ($null -eq $target -or $null -eq $target.requirements) {
  Add-Gap $ProjectRoot $round "GAP-REQ-000" "requirement" "HARD_FAIL" "requirement-target.json is missing or invalid" "Generate requirement-target.json from PRD and rerun comparison." (Get-RelativeEvidencePath $ProjectRoot $p.RequirementTarget)
  $gaps++
} elseif (@($target.requirements).Count -eq 0) {
  Add-Gap $ProjectRoot $round "GAP-REQ-001" "requirement" "IN_SCOPE_GAP" "No normalized requirements are listed in requirement-target.json" "Normalize docs/auto-execute/requirement-candidates.json into requirement-target.json with P0/P1/P2 acceptance criteria, surfaces, and evidence expectations." (Get-RelativeEvidencePath $ProjectRoot $p.RequirementCandidates)
  $gaps++
} else {
  foreach ($req in @($target.requirements)) {
    if ($req.status -eq "PASS_WITH_LIMITATION") { $hasLimitations = $true }
    if ($req.status -eq "CANDIDATE" -or $req.normalized -eq $false) {
      Add-Gap $ProjectRoot $round "GAP-$($req.id)-NORMALIZE" "requirement" "IN_SCOPE_GAP" "Requirement $($req.id) is still an auto-extracted candidate, not normalized acceptance criteria." "Normalize requirement $($req.id) into P0/P1/P2 priority, acceptance criteria, surface/API/UI/test mapping, and evidence expectations." $req.source
      $gaps++
      continue
    }
    if ($req.priority -in @("P0","P1") -and $req.status -ne "PASS" -and $req.status -ne "PASS_WITH_LIMITATION") {
      Add-Gap $ProjectRoot $round "GAP-$($req.id)" "requirement" "IN_SCOPE_GAP" "Requirement $($req.id) is $($req.status), not PASS." "Implement and attach evidence for requirement $($req.id)." $req.source
      $gaps++
    }
    if (($req.status -eq "PASS" -or $req.status -eq "PASS_WITH_LIMITATION") -and @($req.evidence).Count -eq 0) {
      Add-Gap $ProjectRoot $round "GAP-$($req.id)-EVIDENCE" "requirement" "HARD_FAIL" "Requirement $($req.id) is marked pass without evidence." "Attach test/log/screenshot evidence before PASS." $req.source
      $gaps++
    }
  }
}

$status = if ($gaps -eq 0) { if ($hasLimitations) { "PASS_WITH_LIMITATION" } else { "PASS" } } else { "HARD_FAIL" }
$blockers = @()
if ($gaps -gt 0) { $blockers += "$gaps requirement gap(s)" }
$nextActions = if ($gaps -gt 0) { @("Repair requirement gaps, then rerun comparison.") } elseif ($hasLimitations) { @("No hard requirement gaps remain; preserve documented limitations in final verdict.") } else { @() }
Write-LaneResult $ProjectRoot "compare-requirements" $status @() @((Get-RelativeEvidencePath $ProjectRoot $p.RequirementTarget),(Get-RelativeEvidencePath $ProjectRoot $p.GapListJson)) $blockers $nextActions
Add-VerificationResult $ProjectRoot "compare-requirements" $status "$gaps requirement gap(s)" $p.GapListJson
if ($status -eq "PASS") { Write-Host "[PASS] compare-requirements" }
elseif ($status -eq "PASS_WITH_LIMITATION") { Write-Host "[PASS_WITH_LIMITATION] compare-requirements" }
else { Write-Host "ERROR: compare-requirements found $gaps gap(s)" }
