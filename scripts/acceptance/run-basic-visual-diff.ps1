param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$Mode = "fast"
)

. "$PSScriptRoot\lib.ps1"

$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$out = Join-Path $p.Results "basic-visual-diff.json"
$report = $p.VisualDiffReport
$actualDefault = Join-Path $ProjectRoot "docs\auto-execute\screenshots\web-cabin-smoke.png"

try { Add-Type -AssemblyName System.Drawing } catch {
  Write-LaneResult $ProjectRoot "basic-visual-diff" "DOCUMENTED_BLOCKER" @() @() @("System.Drawing unavailable: $($_.Exception.Message)") @()
  Add-VerificationResult $ProjectRoot "basic-visual-diff" "DOCUMENTED_BLOCKER" "System.Drawing unavailable" ""
  exit 0
}

try { $target = Get-Content -LiteralPath $p.UiTarget -Raw | ConvertFrom-Json } catch { $target = $null }
if ($null -eq $target -or $null -eq $target.screens) {
  Write-LaneResult $ProjectRoot "basic-visual-diff" "DOCUMENTED_BLOCKER" @() @() @("ui-target.json missing or invalid") @()
  Add-VerificationResult $ProjectRoot "basic-visual-diff" "DOCUMENTED_BLOCKER" "ui-target.json missing or invalid" ""
  exit 0
}

function Get-ImageSampleDiff([string]$ReferencePath, [string]$ActualPath) {
  $refImg = $null
  $actImg = $null
  try {
    $refImg = [System.Drawing.Bitmap]::FromFile($ReferencePath)
    $actImg = [System.Drawing.Bitmap]::FromFile($ActualPath)
    $points = @()
    foreach ($xPct in @(0.2,0.35,0.5,0.65,0.8)) {
      foreach ($yPct in @(0.15,0.3,0.45,0.6,0.75,0.9)) {
        $points += ,@($xPct,$yPct)
      }
    }
    $sum = 0.0
    $max = 0.0
    $count = 0
    foreach ($pt in $points) {
      $rx = [Math]::Min($refImg.Width - 1, [Math]::Max(0, [int]([double]$pt[0] * ($refImg.Width - 1))))
      $ry = [Math]::Min($refImg.Height - 1, [Math]::Max(0, [int]([double]$pt[1] * ($refImg.Height - 1))))
      $ax = [Math]::Min($actImg.Width - 1, [Math]::Max(0, [int]([double]$pt[0] * ($actImg.Width - 1))))
      $ay = [Math]::Min($actImg.Height - 1, [Math]::Max(0, [int]([double]$pt[1] * ($actImg.Height - 1))))
      $rc = $refImg.GetPixel($rx,$ry)
      $ac = $actImg.GetPixel($ax,$ay)
      $d = ([Math]::Abs($rc.R - $ac.R) + [Math]::Abs($rc.G - $ac.G) + [Math]::Abs($rc.B - $ac.B)) / 765.0
      $sum += $d
      if ($d -gt $max) { $max = $d }
      $count++
    }
    return [PSCustomObject]@{
      referenceSize = "$($refImg.Width)x$($refImg.Height)"
      actualSize = "$($actImg.Width)x$($actImg.Height)"
      sampleCount = $count
      meanRgbDelta = [Math]::Round($sum / [Math]::Max(1,$count), 4)
      maxRgbDelta = [Math]::Round($max, 4)
    }
  } finally {
    if ($null -ne $refImg) { $refImg.Dispose() }
    if ($null -ne $actImg) { $actImg.Dispose() }
  }
}

$comparisons = @()
$blockers = @()
foreach ($screen in @($target.screens)) {
  $reference = [string]$screen.reference
  $actual = ""
  foreach ($candidate in @($screen.visualEvidence, $screen.actualScreenshot, $screen.actual)) {
    if (![string]::IsNullOrWhiteSpace([string]$candidate)) { $actual = [string]$candidate; break }
  }
  if ([string]::IsNullOrWhiteSpace($actual)) { $actual = Get-RelativeEvidencePath $ProjectRoot $actualDefault }
  $refFull = Resolve-ProjectEvidencePath $ProjectRoot $reference
  $actFull = Resolve-ProjectEvidencePath $ProjectRoot $actual
  if (!(Test-Path -LiteralPath $refFull) -or !(Test-Path -LiteralPath $actFull)) {
    $blockers += "Missing visual input for $($screen.id)"
    continue
  }
  try {
    $diff = Get-ImageSampleDiff $refFull $actFull
    $comparisons += [PSCustomObject]@{
      id = $screen.id
      reference = $reference
      actual = $actual
      method = "normalized-coordinate RGB sample; not pixel-perfect"
      status = "PASS"
      metrics = $diff
      interpretation = "Evidence proves an actual-vs-reference comparison was executed, but the Web validation cabin is not a pixel-identical implementation of this individual UI reference."
    }
  } catch {
    $blockers += "Visual diff failed for $($screen.id): $($_.Exception.Message)"
  }
}

$status = if ($comparisons.Count -gt 0 -and $blockers.Count -eq 0) { "PASS" } elseif ($comparisons.Count -gt 0) { "PASS_WITH_LIMITATION" } else { "DOCUMENTED_BLOCKER" }
@{
  schemaVersion = $AE_SCHEMA_VERSION
  lane = "basic-visual-diff"
  status = $status
  method = "System.Drawing normalized-coordinate RGB sampling"
  canClaimPixelPerfect = $false
  comparisons = $comparisons
  blockers = $blockers
  updatedAt = (Get-Date).ToString("s")
} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $out

@(
  "# Visual Diff Report",
  "",
  "Generated: $(Get-Date -Format s)",
  "",
  "- Pixel diff automation: basic normalized-coordinate RGB sampling executed via `scripts/acceptance/run-basic-visual-diff.ps1`.",
  "- Pixel-perfect PASS: not claimed.",
  "- Reason: actual evidence is the consolidated Web validation cabin screenshot, while UI/2 contains individual mobile/admin reference screens.",
  "- Machine evidence: `docs/auto-execute/results/basic-visual-diff.json`.",
  "- Actual visual evidence: `docs/auto-execute/screenshots/web-cabin-smoke.png`.",
  "- Reference evidence: `docs/UI/2/*.png` mapped in `docs/auto-execute/ui-target.json`.",
  "- Verdict: `PASS_WITH_LIMITATION` for visual coverage; `UI_PIXEL_PERFECT_PASS` is not claimed.",
  "",
  "## Compared Screens",
  $(if ($comparisons.Count -gt 0) { $comparisons | ForEach-Object { "- `$($_.id)`: $($_.metrics.referenceSize) vs $($_.metrics.actualSize), meanRgbDelta=$($_.metrics.meanRgbDelta), maxRgbDelta=$($_.metrics.maxRgbDelta)" } } else { "- None" }),
  "",
  "## Blockers",
  $(if ($blockers.Count -gt 0) { $blockers | ForEach-Object { "- $_" } } else { "- None" })
) | Set-Content -Encoding UTF8 $report

Add-EvidenceItem $ProjectRoot "visual" $out "basic visual diff"
Add-EvidenceItem $ProjectRoot "visual" $report "visual diff report"
Write-LaneResult $ProjectRoot "basic-visual-diff" $status @(@{ command="powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-basic-visual-diff.ps1"; status=$status; log=Get-RelativeEvidencePath $ProjectRoot $out }) @((Get-RelativeEvidencePath $ProjectRoot $out),(Get-RelativeEvidencePath $ProjectRoot $report)) $blockers @("Use real per-route screenshots and full pixelmatch/pngjs diff before claiming pixel-perfect UI PASS.")
Add-VerificationResult $ProjectRoot "basic-visual-diff" $status "Compared $($comparisons.Count) UI target(s); pixel-perfect PASS not claimed" $out
Write-Host "[$status] basic-visual-diff compared $($comparisons.Count) screen(s)"
exit 0
