param([string]$ProjectRoot = (Get-Location).Path)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Summaries "git-status.md"
Ensure-Dir (Split-Path $out)
Push-Location $ProjectRoot
try {
  "# Git Status`n`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $out
  Add-Content -Path $out -Encoding UTF8 -Value @("", "## Branch", '```text')
  git branch --show-current 2>&1 | Add-Content -Encoding UTF8 $out
  Add-Content -Path $out -Encoding UTF8 -Value '```'
  Add-Content -Path $out -Encoding UTF8 -Value @("", "## Status", '```text')
  git status --short 2>&1 | Add-Content -Encoding UTF8 $out
  Add-Content -Path $out -Encoding UTF8 -Value '```'
  Add-VerificationResult $ProjectRoot "collect-git-status" "PASS" "Git status collected" $out
  Write-LaneResult $ProjectRoot "git-status" "PASS" @(@{ command = "git status --short"; status = "PASS"; log = Get-RelativeEvidencePath $ProjectRoot $out }) @((Get-RelativeEvidencePath $ProjectRoot $out)) @() @()
  Write-Host "[PASS] collect-git-status"
} finally { Pop-Location }
