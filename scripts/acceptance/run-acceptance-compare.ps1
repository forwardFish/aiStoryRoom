param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$comparisonDir = Join-Path $p.Docs "comparison"
Ensure-Dir $comparisonDir
$round = (Get-ChildItem -LiteralPath $comparisonDir -Filter "round-*.json" -ErrorAction SilentlyContinue | Measure-Object).Count + 1
$roundId = "round-$('{0:D3}' -f $round)"
$roundJson = Join-Path $comparisonDir "$roundId.json"
$roundMd = Join-Path $comparisonDir "$roundId.md"
$loopDoc = Join-Path $p.Docs "18-acceptance-comparison-loop.md"
if (!(Test-Path -LiteralPath $loopDoc)) {
  "# Acceptance Comparison Loop`n`n| Round | Result | Requirement alignment | UI alignment | Contract alignment | Test evidence | Remaining gaps | Next action | Evidence |`n|---|---|---|---|---|---|---|---|`n" | Set-Content -Encoding UTF8 $loopDoc
}

$docsToCheck = @(
  @{ kind="requirements"; path=Join-Path $p.Docs "02-requirement-traceability-matrix.md" },
  @{ kind="ui"; path=Join-Path $p.Docs "04-visual-acceptance-checklist.md" },
  @{ kind="surface"; path=Join-Path $p.Docs "03-surface-map.md" },
  @{ kind="contract"; path=Join-Path $p.Docs "04-contract-map.md" },
  @{ kind="frontendPlan"; path=Join-Path $p.Docs "14-frontend-implementation-plan.md" },
  @{ kind="backendPlan"; path=Join-Path $p.Docs "15-backend-implementation-plan.md" },
  @{ kind="integratedPlan"; path=Join-Path $p.Docs "16-integrated-verification-plan.md" },
  @{ kind="finalChecklist"; path=Join-Path $p.Docs "17-final-acceptance-checklist.md" }
)

$hardGapPatterns = @(
  "\bpending\b",
  "\bnot started\b",
  "\bpartial\b",
  "\bTODO\b",
  "\bTBD\b",
  "\bmissing\b",
  "\bmismatch\b",
  "\bHARD_FAIL\b",
  "\bIN_SCOPE_GAP\b",
  "- \[ \]"
)
$limitationPatterns = @(
  "\bPASS_WITH_LIMITATION\b",
  "\bDOCUMENTED_BLOCKER\b",
  "\bBLOCKED_BY_ENVIRONMENT\b",
  "\bMANUAL_REVIEW_REQUIRED\b",
  "\bPRODUCT_DECISION_REQUIRED\b",
  "\bDEFERRED\b"
)

$gaps = @()
$limitations = @()
foreach ($doc in $docsToCheck) {
  if (!(Test-Path -LiteralPath $doc.path)) {
    $gaps += @{ kind=$doc.kind; severity="HARD_FAIL"; detail="Missing required evidence file"; path=Get-RelativeEvidencePath $ProjectRoot $doc.path }
    continue
  }
  try { $text = Get-Content -LiteralPath $doc.path -Raw -ErrorAction Stop } catch { $text = "" }
  if ([string]::IsNullOrWhiteSpace($text)) {
    $gaps += @{ kind=$doc.kind; severity="HARD_FAIL"; detail="Evidence file is empty"; path=Get-RelativeEvidencePath $ProjectRoot $doc.path }
    continue
  }
  foreach ($pattern in $hardGapPatterns) {
    if ($text -match $pattern) {
      $gaps += @{ kind=$doc.kind; severity="IN_SCOPE_GAP"; detail="Hard pattern found: $pattern"; path=Get-RelativeEvidencePath $ProjectRoot $doc.path }
      break
    }
  }
  foreach ($pattern in $limitationPatterns) {
    if ($text -match $pattern) {
      $limitations += @{ kind=$doc.kind; severity="PASS_WITH_LIMITATION"; detail="Limitation/status pattern found: $pattern"; path=Get-RelativeEvidencePath $ProjectRoot $doc.path }
      break
    }
  }
}

try { $summary = Get-Content -LiteralPath $p.MachineSummary -Raw | ConvertFrom-Json } catch { $summary = $null }
if ($null -eq $summary) {
  $gaps += @{ kind="machineSummary"; severity="HARD_FAIL"; detail="machine-summary.json missing or invalid"; path=Get-RelativeEvidencePath $ProjectRoot $p.MachineSummary }
} elseif ($summary.finalVerdict -eq "HARD_FAIL") {
  $gaps += @{ kind="machineSummary"; severity="HARD_FAIL"; detail="machine-summary finalVerdict is HARD_FAIL"; path=Get-RelativeEvidencePath $ProjectRoot $p.MachineSummary }
} elseif ($summary.finalVerdict -in @("PASS_WITH_LIMITATION","BLOCKED","REPAIR_REQUIRED")) {
  $limitations += @{ kind="machineSummary"; severity=$summary.finalVerdict; detail="machine-summary finalVerdict is $($summary.finalVerdict)"; path=Get-RelativeEvidencePath $ProjectRoot $p.MachineSummary }
}

$status = if ($gaps.Count -gt 0) { "HARD_FAIL" } elseif ($limitations.Count -gt 0) { "PASS_WITH_LIMITATION" } else { "PASS" }
$nextAction = if ($status -eq "PASS") {
  "No unresolved comparison gaps detected. Proceed to code review/final report."
} elseif ($status -eq "PASS_WITH_LIMITATION") {
  "No hard comparison gaps detected. Preserve limitations in final report; do not claim pure PASS or pixel-perfect completion."
} else {
  "Use this comparison round as the next repair input, update implementation/evidence, then run another comparison round."
}

$result = @{
  schemaVersion = $AE_SCHEMA_VERSION
  lane = "acceptance-compare"
  round = $round
  status = $status
  generatedAt = (Get-Date).ToString("s")
  compared = $docsToCheck | ForEach-Object { Get-RelativeEvidencePath $ProjectRoot $_.path }
  gaps = $gaps
  limitations = $limitations
  nextActions = @($nextAction)
}
$result | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $roundJson

@(
  "# Acceptance Comparison $roundId",
  "",
  "Generated: $(Get-Date)",
  "",
  "- Status: $status",
  "- Next action: $nextAction",
  "",
  "## Gaps",
  $(if ($gaps.Count -gt 0) { $gaps | ForEach-Object { "- [$($_.severity)] $($_.kind): $($_.detail) ($($_.path))" } } else { "- None detected" }),
  "",
  "## Limitations",
  $(if ($limitations.Count -gt 0) { $limitations | ForEach-Object { "- [$($_.severity)] $($_.kind): $($_.detail) ($($_.path))" } } else { "- None detected" })
) | Set-Content -Encoding UTF8 $roundMd

Add-Content -Encoding UTF8 $loopDoc "| $roundId | $status | $(if($gaps.kind -contains 'requirements'){'gap'}else{'ok'}) | $(if($gaps.kind -contains 'ui'){'gap'}else{'ok'}) | $(if($gaps.kind -contains 'contract'){'gap'}else{'ok'}) | $(if($gaps.kind -contains 'verification'){'gap'}else{'ok'}) | $($gaps.Count) gaps / $($limitations.Count) limitations | $nextAction | $(Get-RelativeEvidencePath $ProjectRoot $roundJson) |"
Add-EvidenceItem $ProjectRoot "other" $roundJson "acceptance comparison $roundId"
Add-EvidenceItem $ProjectRoot "other" $roundMd "acceptance comparison $roundId report"
Write-LaneResult $ProjectRoot "acceptance-compare" $status @() @((Get-RelativeEvidencePath $ProjectRoot $roundJson),(Get-RelativeEvidencePath $ProjectRoot $roundMd)) $gaps @($nextAction)
Add-VerificationResult $ProjectRoot "acceptance-compare" $status "Comparison $roundId found $($gaps.Count) hard gap(s), $($limitations.Count) limitation(s)" $roundJson

if ($status -eq "PASS") { Write-Host "[PASS] acceptance-compare $roundId" }
elseif ($status -eq "PASS_WITH_LIMITATION") { Write-Host "[PASS_WITH_LIMITATION] acceptance-compare $roundId found $($limitations.Count) limitation(s)" }
else { Write-Host "ERROR: acceptance-compare $roundId found $($gaps.Count) hard gap(s)" }
