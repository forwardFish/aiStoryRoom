param([string]$ProjectRoot = (Get-Location).Path, [ValidateSet("completed","blocked")] [string]$Status = "completed", [string]$FeatureId = "")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
$p = Get-AEPaths $ProjectRoot
if ([string]::IsNullOrWhiteSpace($FeatureId)) {
  $locks = Get-ChildItem (Join-Path $p.Tasks "current") -Filter *.json -ErrorAction SilentlyContinue
  if ($locks.Count -eq 0) { throw "No current task lock found" }
  $FeatureId = $locks[0].BaseName
}
$src = Join-Path (Join-Path $p.Tasks "current") "$FeatureId.json"
$dst = Join-Path (Join-Path $p.Tasks $Status) "$FeatureId-$(Get-Date -Format 'yyyyMMddHHmmss').json"
Move-Item $src $dst
Add-VerificationResult $ProjectRoot "release-task" "PASS" "Released $FeatureId as $Status" $dst
Write-Host "[PASS] released $FeatureId -> $Status"
