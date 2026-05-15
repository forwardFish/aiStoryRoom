param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Summaries "error-summary.md"
"# Error Summary`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $out
if (Test-Path $p.Logs) {
  Get-ChildItem $p.Logs -File | ForEach-Object {
    $m = Select-String -Path $_.FullName -Pattern "ERROR|BLOCKER|FAIL|Exception|failed" -ErrorAction SilentlyContinue
    if ($m) {
      Add-Content -Encoding UTF8 $out "`n## $($_.Name)"
      $m | Select-Object -First 20 | ForEach-Object { Add-Content -Encoding UTF8 $out "- Line $($_.LineNumber): $($_.Line.Trim())" }
    }
  }
}
Add-VerificationResult $ProjectRoot "summarize-errors" "PASS" "Error summary generated" $out
Write-LaneResult $ProjectRoot "repair" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $out),(Get-RelativeEvidencePath $ProjectRoot $p.RepairAttempts)) @() @()
Write-Host "[PASS] summarize-errors"
