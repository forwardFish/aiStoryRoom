param([string]$ProjectRoot = (Get-Location).Path, [string]$FeatureId = "")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
$p = Get-AEPaths $ProjectRoot
if ([string]::IsNullOrWhiteSpace($FeatureId)) {
  $cur = Get-Content (Join-Path $p.Features "current_feature.json") -Raw | ConvertFrom-Json
  $FeatureId = $cur.current.id
}
$lock = Join-Path (Join-Path $p.Tasks "current") "$FeatureId.json"
if (Test-Path $lock) { Add-Blocker $ProjectRoot "claim-task" "DOCUMENTED_BLOCKER" "Task already locked: $FeatureId"; exit 1 }
@{ featureId=$FeatureId; claimedBy=$env:USERNAME; claimedAt=(Get-Date).ToString("s") } | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $lock
Add-VerificationResult $ProjectRoot "claim-task" "PASS" "Claimed $FeatureId" $lock
Write-Host "[PASS] claimed $FeatureId"
