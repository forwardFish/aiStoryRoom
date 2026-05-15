param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$inventory = Join-Path $p.Docs "UI_REFERENCE_INVENTORY.md"
"# UI Reference Inventory`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $inventory
$count = 0
foreach ($dir in @((Join-Path $ProjectRoot "docs\design\UI"), (Join-Path $ProjectRoot "docs\UI"))) {
  if (Test-Path $dir) {
    Add-Content -Encoding UTF8 $inventory "`n## $dir"
    Get-ChildItem $dir -Recurse -File -Include *.png,*.jpg,*.jpeg,*.webp,*.gif,*.html | ForEach-Object { $count++; Add-Content -Encoding UTF8 $inventory "- $($_.FullName)" }
  }
}
if ($count -eq 0) {
  Add-Blocker $ProjectRoot "visual-smoke" "DEFERRED" "No UI references found"
  Write-LaneResult $ProjectRoot "visual" "DEFERRED" @() @((Get-RelativeEvidencePath $ProjectRoot $inventory)) @("No UI references found") @()
  Write-Host "[DEFERRED] visual-smoke"
}
else {
  Add-VerificationResult $ProjectRoot "visual:inventory" "PASS" "$count UI references indexed" $inventory
  Add-EvidenceItem $ProjectRoot "visual" $inventory "UI reference inventory"
  Write-Host "[PASS] UI inventory: $count"
}
$uiTarget = $p.UiTarget
$screenshot = Join-Path $p.Screenshots "web-cabin-smoke.png"
$visualDiff = Join-Path $p.Docs "visual-diff-report.md"
$basicVisualDiff = Join-Path $p.Results "basic-visual-diff.json"
$blockers = @()
$evidence = @((Get-RelativeEvidencePath $ProjectRoot $inventory))
if (Test-Path -LiteralPath $screenshot) { $evidence += Get-RelativeEvidencePath $ProjectRoot $screenshot } else { $blockers += "web-cabin-smoke.png screenshot not found" }
if (Test-Path -LiteralPath $uiTarget) { $evidence += Get-RelativeEvidencePath $ProjectRoot $uiTarget } else { $blockers += "ui-target.json not found" }
if (Test-Path -LiteralPath $visualDiff) { $evidence += Get-RelativeEvidencePath $ProjectRoot $visualDiff }
if (Test-Path -LiteralPath $basicVisualDiff) { $evidence += Get-RelativeEvidencePath $ProjectRoot $basicVisualDiff }

try { $target = Get-Content -LiteralPath $uiTarget -Raw | ConvertFrom-Json } catch { $target = $null }
if ($null -eq $target -or @($target.screens).Count -eq 0) {
  $blockers += "ui-target.json has no mapped screens"
} else {
  foreach ($screen in @($target.screens)) {
    if ($screen.status -in @("PASS","PASS_WITH_LIMITATION")) {
      $actual = ""
      foreach ($candidate in @($screen.visualEvidence, $screen.actualScreenshot, $screen.actual)) {
        if (![string]::IsNullOrWhiteSpace([string]$candidate)) { $actual = [string]$candidate; break }
      }
      if ([string]::IsNullOrWhiteSpace($actual) -or !(Test-ProjectEvidencePath $ProjectRoot $actual)) {
        $blockers += "screen $($screen.id) lacks existing visual evidence"
      }
    }
  }
}

if ($blockers.Count -gt 0) {
  Add-VerificationResult $ProjectRoot "visual-smoke" "HARD_FAIL" ($blockers -join "; ") $inventory
  Write-LaneResult $ProjectRoot "visual" "HARD_FAIL" @() $evidence $blockers @("Capture actual visual evidence and update ui-target.json.")
  Write-Host "[HARD_FAIL] visual-smoke"
} else {
  $detail = if (Test-Path -LiteralPath $basicVisualDiff) {
    "UI references mapped to existing actual screenshot evidence; basic actual-vs-reference visual diff evidence exists, but pixel-perfect is not claimed"
  } else {
    "UI references mapped to existing actual screenshot evidence; no pixel diff evidence, so pixel-perfect is not claimed"
  }
  Add-VerificationResult $ProjectRoot "visual-smoke" "PASS_WITH_LIMITATION" $detail $screenshot
  Write-LaneResult $ProjectRoot "visual" "PASS_WITH_LIMITATION" @() $evidence @() @("Manual pixel-level comparison remains required before pixel-perfect PASS.")
  Write-Host "[PASS_WITH_LIMITATION] visual-smoke"
}
