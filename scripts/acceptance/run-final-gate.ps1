param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
Update-MachineSummary $ProjectRoot
$p = Get-AEPaths $ProjectRoot
function Read-JsonFile($Path) {
  try {
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
    return ($raw | ConvertFrom-Json)
  } catch { return $null }
}
$gapList = Read-JsonFile $p.GapListJson
$summary = Read-JsonFile $p.MachineSummary
$requirementsTarget = Read-JsonFile $p.RequirementTarget
$requirementCandidates = Read-JsonFile $p.RequirementCandidates
$uiTarget = Read-JsonFile $p.UiTarget

$hardGaps = @()
if ($null -ne $gapList) {
  $hardGaps = @($gapList.gaps) | Where-Object { $_.severity -in @("HARD_FAIL","IN_SCOPE_GAP") -and $_.status -ne "CLOSED" }
}
$verdict = "PASS"
$reasons = @()
if ($hardGaps.Count -gt 0) { $verdict = "HARD_FAIL"; $reasons += "$($hardGaps.Count) unresolved hard/in-scope gap(s)" }
if ($null -eq $summary) { $verdict = "HARD_FAIL"; $reasons += "machine-summary.json missing or invalid" }
elseif (@($summary.hardFails).Count -gt 0) { $verdict = "HARD_FAIL"; $reasons += "machine summary contains hard failures" }
elseif ($verdict -eq "PASS" -and ((@($summary.documentedBlockers).Count + @($summary.manualReviewRequired).Count + @($summary.deferred).Count) -gt 0)) {
  $verdict = "PASS_WITH_LIMITATION"
  $reasons += "manual/deferred/documented blocker lanes remain"
}

if ($null -eq $requirementsTarget -or $null -eq $requirementsTarget.requirements) {
  $verdict = "HARD_FAIL"
  $reasons += "requirement-target.json missing or invalid"
} else {
  if (@($requirementsTarget.requirements).Count -eq 0 -and $null -ne $requirementCandidates -and @($requirementCandidates.candidates).Count -gt 0) {
    $verdict = "HARD_FAIL"
    $reasons += "requirement-candidates.json has candidates but requirement-target.json has no normalized requirements"
  }
  foreach ($req in @($requirementsTarget.requirements)) {
    if ($req.status -eq "CANDIDATE" -or $req.normalized -eq $false) {
      $verdict = "HARD_FAIL"
      $reasons += "requirement-target.json contains unnormalized candidate requirement $($req.id)"
    }
    if ($req.priority -in @("P0","P1")) {
      if ($req.status -notin @("PASS","PASS_WITH_LIMITATION")) {
        $verdict = "HARD_FAIL"
        $reasons += "P0/P1 requirement $($req.id) is not PASS/PASS_WITH_LIMITATION"
      }
      if (@($req.evidence).Count -eq 0) {
        $verdict = "HARD_FAIL"
        $reasons += "P0/P1 requirement $($req.id) has no evidence"
      }
    }
  }
}

if ($null -ne $uiTarget -and $null -ne $uiTarget.screens) {
  foreach ($screen in @($uiTarget.screens)) {
    $screenId = if ([string]::IsNullOrWhiteSpace([string]$screen.id)) { "UNKNOWN" } else { [string]$screen.id }
    $required = !($screen.required -eq $false -or $screen.status -in @("DEFERRED","DOCUMENTED_BLOCKER","BLOCKED_BY_ENVIRONMENT"))
    if ($required) {
      $actual = ""
      foreach ($candidate in @($screen.visualEvidence, $screen.actualScreenshot, $screen.actual)) {
        if (![string]::IsNullOrWhiteSpace([string]$candidate)) { $actual = [string]$candidate; break }
      }
      if ([string]::IsNullOrWhiteSpace($actual) -or !(Test-ProjectEvidencePath $ProjectRoot $actual)) {
        $verdict = "HARD_FAIL"
        $reasons += "required UI screen $screenId has no existing actual screenshot/visual evidence"
      }
      if (![string]::IsNullOrWhiteSpace([string]$screen.structureStatus) -and $screen.structureStatus -ne "PASS") {
        $verdict = "HARD_FAIL"
        $reasons += "required UI screen $screenId structureStatus is not PASS"
      }
      if ($screen.pixelPerfectStatus -eq "PASS") {
        $diff = ""
        foreach ($candidate in @($screen.visualDiff, $screen.visualDiffEvidence, $screen.diffEvidence)) {
          if (![string]::IsNullOrWhiteSpace([string]$candidate)) { $diff = [string]$candidate; break }
        }
        if ([string]::IsNullOrWhiteSpace($diff) -or !(Test-ProjectEvidencePath $ProjectRoot $diff)) {
          $verdict = "HARD_FAIL"
          $reasons += "required UI screen $screenId pixelPerfectStatus PASS has no visual diff evidence"
        }
      }
    }
  }
}

$reportIntegrityPath = Join-Path $p.Results "report-integrity.json"
if (Test-Path -LiteralPath $reportIntegrityPath) {
  try { $reportIntegrity = Get-Content -LiteralPath $reportIntegrityPath -Raw | ConvertFrom-Json } catch { $reportIntegrity = $null }
  if ($null -eq $reportIntegrity -or $reportIntegrity.status -ne "PASS") {
    $verdict = "HARD_FAIL"
    $reasons += "report-integrity result is not PASS"
  }
} else {
  $verdict = "HARD_FAIL"
  $reasons += "report-integrity result is missing"
}

$secretGuardPath = Join-Path $p.Results "secret-guard.json"
if (Test-Path -LiteralPath $secretGuardPath) {
  try { $secretGuard = Get-Content -LiteralPath $secretGuardPath -Raw | ConvertFrom-Json } catch { $secretGuard = $null }
  if ($null -eq $secretGuard -or $secretGuard.status -notin @("PASS","DOCUMENTED_BLOCKER","BLOCKED_BY_ENVIRONMENT")) {
    $verdict = "HARD_FAIL"
    $reasons += "secret-guard result is not PASS or documented blocker"
  } elseif ($secretGuard.status -in @("DOCUMENTED_BLOCKER","BLOCKED_BY_ENVIRONMENT") -and $verdict -eq "PASS") {
    $verdict = "PASS_WITH_LIMITATION"
    $reasons += "secret-guard has documented blocker"
  }
} else {
  $verdict = "HARD_FAIL"
  $reasons += "secret-guard result is missing"
}

$requirementsCovered = $true
$storiesCovered = $true
$uiScreenshotsCovered = $false
$contractVerified = $false
$e2eVerified = $false
$manualReviewRemaining = $false

if ($null -eq $requirementsTarget -or $null -eq $requirementsTarget.requirements -or @($requirementsTarget.requirements).Count -eq 0) {
  $requirementsCovered = $false
} else {
  foreach ($req in @($requirementsTarget.requirements)) {
    if ($req.status -eq "CANDIDATE" -or $req.normalized -eq $false) { $requirementsCovered = $false }
    if ($req.priority -in @("P0","P1") -and ($req.status -notin @("PASS","PASS_WITH_LIMITATION") -or @($req.evidence).Count -eq 0)) {
      $requirementsCovered = $false
    }
  }
}

$storyTargetPath = Join-Path $p.Docs "story-target.json"
if (Test-Path -LiteralPath $storyTargetPath) {
  try { $storyTarget = Get-Content -LiteralPath $storyTargetPath -Raw | ConvertFrom-Json } catch { $storyTarget = $null }
  if ($null -eq $storyTarget -or $null -eq $storyTarget.stories -or @($storyTarget.stories).Count -eq 0) {
    $storiesCovered = $false
  } else {
    foreach ($story in @($storyTarget.stories)) {
      if ($story.status -eq "CANDIDATE" -or $story.normalized -eq $false) { $storiesCovered = $false }
      if ($story.priority -in @("P0","P1")) {
        if (@($story.acceptanceCriteria).Count -eq 0 -or @($story.testPoints).Count -eq 0) { $storiesCovered = $false }
        if ($null -ne $story.evidence -and @($story.evidence).Count -eq 0) { $storiesCovered = $false }
      }
    }
  }
} else {
  $storiesCovered = $false
}

if ($null -ne $uiTarget -and $null -ne $uiTarget.screens) {
  $uiScreens = @($uiTarget.screens)
  $uiScreenshotsCovered = ($uiScreens.Count -gt 0 -and (@($uiScreens | Where-Object {
    $actual = ""
    foreach ($candidate in @($_.visualEvidence, $_.actualScreenshot, $_.actual)) {
      if (![string]::IsNullOrWhiteSpace([string]$candidate)) { $actual = [string]$candidate; break }
    }
    [string]::IsNullOrWhiteSpace($actual) -or !(Test-ProjectEvidencePath $ProjectRoot $actual)
  }).Count -eq 0))
}

$contractResultPath = Join-Path $p.Results "contract.json"
if (Test-Path -LiteralPath $contractResultPath) {
  try { $contractResult = Get-Content -LiteralPath $contractResultPath -Raw | ConvertFrom-Json; $contractVerified = ($contractResult.status -in @("PASS","PASS_WITH_LIMITATION")) } catch {}
}

$integrationResultPath = Join-Path $p.Results "integration.json"
$e2eFlowResultPath = Join-Path $p.Results "e2e-flow.json"
if (Test-Path -LiteralPath $integrationResultPath) {
  try { $integrationResult = Get-Content -LiteralPath $integrationResultPath -Raw | ConvertFrom-Json; $e2eVerified = ($integrationResult.status -eq "PASS") } catch {}
} elseif (Test-Path -LiteralPath $e2eFlowResultPath) {
  try { $e2eResult = Get-Content -LiteralPath $e2eFlowResultPath -Raw | ConvertFrom-Json; $e2eVerified = ($e2eResult.status -eq "PASS") } catch {}
}

if ($null -ne $summary) {
  $manualReviewRemaining = (@($summary.manualReviewRequired).Count + @($summary.documentedBlockers).Count + @($summary.deferred).Count) -gt 0
} else {
  $manualReviewRemaining = $true
}

$confidenceFactors = [ordered]@{
  requirementsCovered = $requirementsCovered
  storiesCovered = $storiesCovered
  uiScreenshotsCovered = $uiScreenshotsCovered
  contractVerified = $contractVerified
  e2eVerified = $e2eVerified
  manualReviewRemaining = $manualReviewRemaining
}

$confidence = [double]1.0
if (-not $requirementsCovered) { $confidence -= [double]0.15 }
if (-not $storiesCovered) { $confidence -= [double]0.15 }
if (-not $uiScreenshotsCovered) { $confidence -= [double]0.20 }
if (-not $contractVerified) { $confidence -= [double]0.15 }
if (-not $e2eVerified) { $confidence -= [double]0.20 }
if ($manualReviewRemaining) { $confidence -= [double]0.15 }
if ($verdict -eq "HARD_FAIL") { $confidence = [Math]::Min([double]$confidence, [double]0.49) }
elseif ($verdict -eq "PASS_WITH_LIMITATION") { $confidence = [Math]::Min([double]$confidence, [double]0.85) }
$confidence = [Math]::Max([double]0, [Math]::Round([double]$confidence, 2))

$report = $p.FinalConvergenceReport
@(
  "# Final Convergence Report",
  "",
  "Generated: $(Get-Date)",
  "",
  "- Verdict: $verdict",
  "- Acceptance confidence: $confidence",
  "- Gap list: $(Get-RelativeEvidencePath $ProjectRoot $p.GapListJson)",
  "- Machine summary: $(Get-RelativeEvidencePath $ProjectRoot $p.MachineSummary)",
  "",
  "## Reasons",
  $(if ($reasons.Count -gt 0) { $reasons | ForEach-Object { "- $_" } } else { "- No hard/in-scope gaps detected." })
) | Set-Content -Encoding UTF8 $report

@{
  schemaVersion = $AE_SCHEMA_VERSION
  status = $verdict
  currentRound = Get-CurrentConvergenceRound $ProjectRoot
  finalVerdict = $verdict
  acceptanceConfidence = $confidence
  confidenceFactors = $confidenceFactors
  lastGapCount = $hardGaps.Count
  updatedAt = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.ConvergenceState

$laneStatus = if ($verdict -eq "HARD_FAIL") { "HARD_FAIL" } elseif ($verdict -eq "BLOCKED") { "BLOCKED" } elseif ($verdict -eq "PASS_WITH_LIMITATION") { "PASS_WITH_LIMITATION" } else { "PASS" }
Write-LaneResult $ProjectRoot "final-gate" $laneStatus @() @((Get-RelativeEvidencePath $ProjectRoot $report),(Get-RelativeEvidencePath $ProjectRoot $p.GapListJson),(Get-RelativeEvidencePath $ProjectRoot $p.MachineSummary)) $reasons @()
try { $summary = Get-Content -LiteralPath $p.MachineSummary -Raw | ConvertFrom-Json } catch { $summary = [PSCustomObject]@{} }
$summary | Add-Member -NotePropertyName finalVerdict -NotePropertyValue $verdict -Force
$summary | Add-Member -NotePropertyName schemaVersion -NotePropertyValue $AE_SCHEMA_VERSION -Force
$summary | Add-Member -NotePropertyName acceptanceConfidence -NotePropertyValue $confidence -Force
$summary | Add-Member -NotePropertyName confidenceFactors -NotePropertyValue $confidenceFactors -Force
$summary | Add-Member -NotePropertyName finalReport -NotePropertyValue (Get-RelativeEvidencePath $ProjectRoot $report) -Force
$summary | Add-Member -NotePropertyName nextRecommendedAction -NotePropertyValue $(if ($verdict -eq "PASS") { "Ready for final human acceptance." } elseif ($verdict -eq "PASS_WITH_LIMITATION") { "Review limitations before final acceptance." } elseif ($verdict -eq "BLOCKED") { "Resolve documented blocker, then rerun final gate." } else { "Read final-convergence-report.md, gap-list.json, and next-agent-action.md; repair failed hard gates before final acceptance." }) -Force
$summary | Add-Member -NotePropertyName updatedAt -NotePropertyValue (Get-Date).ToString("s") -Force
$summary | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.MachineSummary
Add-VerificationResult $ProjectRoot "final-gate" $laneStatus "Final verdict: $verdict" $report
Write-Host "[$laneStatus] final-gate: $verdict"
exit (Get-AEExitCode $verdict)
