param([string]$ProjectRoot = (Get-Location).Path)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$list = Join-Path $p.Features "feature_list.json"
$current = Join-Path $p.Features "current_feature.json"
if (!(Test-Path $list)) { Add-Blocker $ProjectRoot "select-next-feature" "HARD_FAIL" "feature_list.json missing"; exit 1 }
$data = Get-Content $list -Raw | ConvertFrom-Json
$rank = @{ P0=0; P1=1; P2=2 }
$next = @($data.features) | Where-Object { $_.passes -ne $true } | Sort-Object @{Expression={ if ($rank.ContainsKey($_.priority)) { $rank[$_.priority] } else { 99 }}}, id | Select-Object -First 1
if ($null -eq $next) { @{ current=$null; updatedAt=(Get-Date).ToString("s") } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $current; Write-Host "[PASS] no failing feature"; exit 0 }
@{ current=$next; updatedAt=(Get-Date).ToString("s") } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $current
Write-Host "NEXT_FEATURE: $($next.id) - $($next.description)"
Add-VerificationResult $ProjectRoot "select-next-feature" "PASS" "Selected $($next.id)" $current
