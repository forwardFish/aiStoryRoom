param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Summaries "architecture-guard.md"
"# Architecture Guard`n" | Set-Content -Encoding UTF8 $out
$issues = 0
$files = Get-ChildItem $ProjectRoot -Recurse -File -Include *.ps1,*.sh,*.bat,*.cmd,*.js,*.ts,*.py,*.dart -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\node_modules\\|\\.git\\|\\build\\|\\dist\\" }
foreach ($f in $files) {
  try { $txt = Get-Content $f.FullName -Raw -ErrorAction Stop } catch { continue }
  if ($txt -match "(?i)\bgit\s+(reset|clean)\b|\bgit\s+push\b[^\r\n]*(--force|-f)\b|\bforce\s+push\b") { Add-Content -Encoding UTF8 $out "ERROR: destructive git pattern in $($f.FullName)"; $issues++ }
}
if ($issues -gt 0) {
  Add-VerificationResult $ProjectRoot "architecture-guard" "HARD_FAIL" "$issues hard issue(s)" $out
  Write-LaneResult $ProjectRoot "architecture-guard" "HARD_FAIL" @() @((Get-RelativeEvidencePath $ProjectRoot $out)) @("$issues hard issue(s)") @("Remove destructive git command patterns or document safe test-only usage.")
  Write-Host "ERROR: architecture-guard failed"
}
else {
  Add-VerificationResult $ProjectRoot "architecture-guard" "PASS" "No destructive git patterns found" $out
  Write-LaneResult $ProjectRoot "architecture-guard" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $out)) @() @()
  Write-Host "[PASS] architecture-guard"
}
