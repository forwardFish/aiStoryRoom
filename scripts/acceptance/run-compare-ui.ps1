param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$round = Get-CurrentConvergenceRound $ProjectRoot

function First-NonEmpty($Values) {
  foreach ($value in @($Values)) {
    if (![string]::IsNullOrWhiteSpace([string]$value)) { return [string]$value }
  }
  return ""
}

try {
  $rawTarget = [System.IO.File]::ReadAllText($p.UiTarget, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
  $target = $rawTarget | ConvertFrom-Json
} catch {
  $target = $null
  Write-Host "ui-target parse error: $($_.Exception.Message)"
}
$gaps = 0
$hasLimitations = $false
if ($null -eq $target -or $null -eq $target.screens) {
  Add-Gap $ProjectRoot $round "GAP-UI-000" "ui" "HARD_FAIL" "ui-target.json is missing or invalid" "Generate ui-target.json from UI references and rerun comparison." (Get-RelativeEvidencePath $ProjectRoot $p.UiTarget)
  $gaps++
} elseif (@($target.screens).Count -eq 0) {
  $uiRefs = @()
  foreach ($dir in @((Join-Path $ProjectRoot "docs\UI"), (Join-Path $ProjectRoot "docs\design\UI"))) {
    if (Test-Path -LiteralPath $dir) { $uiRefs += Get-ChildItem -LiteralPath $dir -Recurse -File -Include *.png,*.jpg,*.jpeg,*.webp,*.html -ErrorAction SilentlyContinue }
  }
  if ($uiRefs.Count -gt 0) {
    Add-Gap $ProjectRoot $round "GAP-UI-001" "ui" "IN_SCOPE_GAP" "UI references exist but ui-target.json has no screens." "Map UI references to routes/screens in ui-target.json." (Get-RelativeEvidencePath $ProjectRoot $p.UiTarget)
    $gaps++
  }
} else {
  foreach ($screen in @($target.screens)) {
    $screenId = if ([string]::IsNullOrWhiteSpace([string]$screen.id)) { "UNKNOWN" } else { [string]$screen.id }
    $reference = First-NonEmpty @($screen.reference, $screen.referencePath, $screen.uiReference)
    $actual = First-NonEmpty @($screen.visualEvidence, $screen.actualScreenshot, $screen.actual)
    $visualDiff = First-NonEmpty @($screen.visualDiff, $screen.visualDiffEvidence, $screen.diffEvidence)
    $structureStatus = First-NonEmpty @($screen.structureStatus, $screen.structure)
    $visualStatus = First-NonEmpty @($screen.visualStatus, $screen.visual)
    $pixelPerfectStatus = First-NonEmpty @($screen.pixelPerfectStatus, $screen.pixelPerfect)
    $pixelPerfectRequired = ($target.pixelPerfectRequired -eq $true -or $screen.pixelPerfectRequired -eq $true -or $screen.claim -eq "UI_PIXEL_PERFECT_PASS")
    if ($screen.status -in @("PASS_WITH_LIMITATION", "PASS_NEEDS_MANUAL_UI_REVIEW") -or $visualStatus -in @("PASS_WITH_LIMITATION", "PASS_NEEDS_MANUAL_UI_REVIEW") -or $pixelPerfectStatus -in @("MANUAL_REVIEW_REQUIRED", "PASS_NEEDS_MANUAL_UI_REVIEW")) { $hasLimitations = $true }

    if ($screen.status -notin @("PASS", "PASS_WITH_LIMITATION", "PASS_NEEDS_MANUAL_UI_REVIEW")) {
      Add-Gap $ProjectRoot $round "GAP-$screenId" "ui" "IN_SCOPE_GAP" "UI target $screenId is $($screen.status), not PASS." "Implement/capture/compare UI target $screenId." $reference
      $gaps++
    }
    if (![string]::IsNullOrWhiteSpace($structureStatus) -and $structureStatus -ne "PASS") {
      Add-Gap $ProjectRoot $round "GAP-$screenId-STRUCTURE" "ui" "IN_SCOPE_GAP" "UI target $screenId structureStatus is $structureStatus, not PASS." "Fix route/component/state structure for UI target $screenId before visual acceptance." $reference
      $gaps++
    }
    if (![string]::IsNullOrWhiteSpace($visualStatus) -and $visualStatus -notin @("PASS","PASS_WITH_LIMITATION","PASS_NEEDS_MANUAL_UI_REVIEW","MANUAL_REVIEW_REQUIRED")) {
      Add-Gap $ProjectRoot $round "GAP-$screenId-VISUAL-STATUS" "ui" "IN_SCOPE_GAP" "UI target $screenId visualStatus is $visualStatus, not an accepted visual review status." "Capture and compare visual evidence for UI target $screenId." $reference
      $gaps++
    }
    if ($screen.status -in @("PASS","PASS_WITH_LIMITATION","PASS_NEEDS_MANUAL_UI_REVIEW") -and [string]::IsNullOrWhiteSpace($reference)) {
      Add-Gap $ProjectRoot $round "GAP-$screenId-REFERENCE" "ui" "HARD_FAIL" "UI target $screenId is $($screen.status) without a reference path." "Attach the source UI reference path before claiming UI alignment." (Get-RelativeEvidencePath $ProjectRoot $p.UiTarget)
      $gaps++
    } elseif ($screen.status -in @("PASS","PASS_WITH_LIMITATION","PASS_NEEDS_MANUAL_UI_REVIEW") -and !(Test-ProjectEvidencePath $ProjectRoot $reference)) {
      Add-Gap $ProjectRoot $round "GAP-$screenId-REFERENCE-MISSING" "ui" "HARD_FAIL" "UI target $screenId references a missing UI artifact: $reference." "Fix the reference path or restore the UI reference artifact." $reference
      $gaps++
    }
    if ($screen.status -in @("PASS","PASS_WITH_LIMITATION","PASS_NEEDS_MANUAL_UI_REVIEW") -and [string]::IsNullOrWhiteSpace($actual)) {
      Add-Gap $ProjectRoot $round "GAP-$screenId-VISUAL-EVIDENCE" "ui" "HARD_FAIL" "UI target $screenId is $($screen.status) without an actual screenshot or visual evidence path." "Attach an actual screenshot path. Without it, use MANUAL_REVIEW_REQUIRED." $reference
      $gaps++
    } elseif ($screen.status -in @("PASS","PASS_WITH_LIMITATION","PASS_NEEDS_MANUAL_UI_REVIEW") -and !(Test-ProjectEvidencePath $ProjectRoot $actual)) {
      Add-Gap $ProjectRoot $round "GAP-$screenId-ACTUAL-MISSING" "ui" "HARD_FAIL" "UI target $screenId visual evidence file is missing: $actual." "Capture or restore the actual screenshot evidence before claiming UI alignment." $actual
      $gaps++
    }
    if ($screen.status -eq "PASS" -and $pixelPerfectRequired -and ([string]::IsNullOrWhiteSpace($visualDiff) -or !(Test-ProjectEvidencePath $ProjectRoot $visualDiff))) {
      Add-Gap $ProjectRoot $round "GAP-$screenId-VISUAL-DIFF" "ui" "HARD_FAIL" "UI target $screenId claims pixel-perfect PASS without visual diff evidence." "Run pixel diff or downgrade to PASS_WITH_LIMITATION / MANUAL_REVIEW_REQUIRED." $reference
      $gaps++
    }
    if ($pixelPerfectStatus -eq "PASS" -and ([string]::IsNullOrWhiteSpace($visualDiff) -or !(Test-ProjectEvidencePath $ProjectRoot $visualDiff))) {
      Add-Gap $ProjectRoot $round "GAP-$screenId-PIXEL-PERFECT-EVIDENCE" "ui" "HARD_FAIL" "UI target $screenId has pixelPerfectStatus PASS without visual diff evidence." "Attach visual diff evidence or change pixelPerfectStatus to MANUAL_REVIEW_REQUIRED." $reference
      $gaps++
    }
  }
}

$status = if ($gaps -eq 0) { if ($hasLimitations) { "PASS_WITH_LIMITATION" } else { "PASS" } } else { "HARD_FAIL" }
$blockers = @()
if ($gaps -gt 0) { $blockers += "$gaps UI gap(s)" }
$nextActions = if ($gaps -gt 0) { @("Repair UI gaps, then rerun visual/UI comparison.") } elseif ($hasLimitations) { @("No hard UI gaps remain; manual pixel-level review is still required because no visual diff evidence exists.") } else { @() }
Write-LaneResult $ProjectRoot "compare-ui" $status @() @((Get-RelativeEvidencePath $ProjectRoot $p.UiTarget),(Get-RelativeEvidencePath $ProjectRoot $p.GapListJson)) $blockers $nextActions
Add-VerificationResult $ProjectRoot "compare-ui" $status "$gaps UI gap(s)" $p.GapListJson
if ($status -eq "PASS") { Write-Host "[PASS] compare-ui" }
elseif ($status -eq "PASS_WITH_LIMITATION") { Write-Host "[PASS_WITH_LIMITATION] compare-ui" }
else { Write-Host "ERROR: compare-ui found $gaps gap(s)" }
