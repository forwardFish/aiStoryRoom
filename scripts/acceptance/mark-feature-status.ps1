param([string]$ProjectRoot = (Get-Location).Path, [Parameter(Mandatory=$true)] [string]$FeatureId, [ValidateSet("PASS","HARD_FAIL","DOCUMENTED_BLOCKER","DEFERRED","MANUAL_REVIEW_REQUIRED")] [string]$Status = "PASS", [string]$Evidence = "", [string]$Command = "")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$list = Join-Path $p.Features "feature_list.json"
$data = Get-Content $list -Raw | ConvertFrom-Json
$found = $false
foreach ($f in $data.features) {
  if ($f.id -eq $FeatureId) {
    $found = $true
    if ($Status -eq "PASS" -and [string]::IsNullOrWhiteSpace($Evidence)) { throw "Evidence is required for PASS" }
    $f.passes = ($Status -eq "PASS")
    $f.evidence += @(@{ status=$Status; path=$Evidence; command=$Command; updatedAt=(Get-Date).ToString("s") })
  }
}
if (!$found) { throw "Feature not found: $FeatureId" }
$data | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 $list
Add-VerificationResult $ProjectRoot "mark-feature:$FeatureId" $Status "Evidence=$Evidence Command=$Command" $list
Write-Host "[PASS] feature $FeatureId marked $Status"
