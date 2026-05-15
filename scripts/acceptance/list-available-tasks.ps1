param([string]$ProjectRoot = (Get-Location).Path)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
$p = Get-AEPaths $ProjectRoot
foreach ($b in @("available","current","completed","blocked")) {
  Write-Host "`n[$b]"
  Get-ChildItem (Join-Path $p.Tasks $b) -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "- $($_.Name)" }
}
