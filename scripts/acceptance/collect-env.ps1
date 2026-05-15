param([string]$ProjectRoot = (Get-Location).Path)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Docs "00-environment-snapshot.md"
"# Environment Snapshot`n`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $out
foreach ($cmd in @("git --version","node -v","npm -v","pnpm -v","yarn -v","flutter --version","flutter doctor -v","docker --version","docker info","python --version")) {
  Add-Content -Path $out -Encoding UTF8 -Value @("", "## $cmd", '```text')
  try {
    Invoke-Expression $cmd 2>&1 | Out-String | Add-Content -Path $out -Encoding UTF8
  } catch {
    Add-Content -Path $out -Encoding UTF8 -Value "ERROR: $($_.Exception.Message)"
  }
  Add-Content -Path $out -Encoding UTF8 -Value '```'
}
Add-VerificationResult $ProjectRoot "collect-env" "PASS" "Environment snapshot generated" $out
Write-LaneResult $ProjectRoot "environment" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $out)) @() @()
Write-Host "[PASS] collect-env"
