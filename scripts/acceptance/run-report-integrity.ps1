param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
Update-MachineSummary $ProjectRoot

if (-not (Get-HarnessLaneEnabled $ProjectRoot "reportIntegrity" $true)) {
  Write-LaneResult $ProjectRoot "report-integrity" "DEFERRED" @() @() @("reportIntegrity lane disabled in harness.yml") @()
  Write-Host "[DEFERRED] report-integrity"
  exit 0
}

$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Summaries "report-integrity.md"
"# Report Integrity`n`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $out
$issues = @()

$reportFiles = @()
if (Test-Path -LiteralPath $p.FinalReport) { $reportFiles += $p.FinalReport }
Get-ChildItem -LiteralPath $p.Docs -File -Include *.md,*.json -ErrorAction SilentlyContinue | ForEach-Object { $reportFiles += $_.FullName }

foreach ($file in ($reportFiles | Sort-Object -Unique)) {
  try { $txt = Get-Content -LiteralPath $file -Raw -ErrorAction Stop } catch { continue }
  $rel = Get-RelativeEvidencePath $ProjectRoot $file
  if ($txt -match '\$(branch|head|origin|status)\b') { $issues += "$rel contains unexpanded git variable" }
  if (([regex]::Matches($txt, '```').Count % 2) -ne 0) { $issues += "$rel has unmatched Markdown code fence" }
  if ($txt -match '�|锛|鈥|馃|寰呯') { $issues += "$rel may contain mojibake" }
}

try { $manifest = Get-Content -LiteralPath $p.EvidenceManifest -Raw | ConvertFrom-Json } catch { $manifest = $null }
if ($null -eq $manifest) {
  $issues += "evidence-manifest.json missing or invalid"
} else {
  foreach ($bucket in @("screenshots","logs","testReports","apiResults","visualResults","finalReports","other")) {
    foreach ($item in @($manifest.$bucket)) {
      if ($null -eq $item -or [string]::IsNullOrWhiteSpace($item.path)) { continue }
      $path = $item.path
      if (-not [System.IO.Path]::IsPathRooted($path)) { $path = Join-Path $ProjectRoot $path }
      if (!(Test-Path -LiteralPath $path)) { $issues += "manifest references missing evidence: $($item.path)" }
    }
  }
}

Push-Location $ProjectRoot
try {
  $statusNow = git status --short 2>$null | Out-String
  if (Test-Path -LiteralPath $p.FinalReport) {
    $reportTxt = Get-Content -LiteralPath $p.FinalReport -Raw
    if ($reportTxt -match 'Git status' -and $reportTxt -notmatch [regex]::Escape(($statusNow.Trim()))) {
      Add-Content -Encoding UTF8 $out "`nGit status changed since report snapshot or report does not include exact current status.`n"
    }
  }
} finally { Pop-Location }

if ($issues.Count -gt 0) {
  Add-Content -Encoding UTF8 $out "`n## Issues`n"
  $issues | Sort-Object -Unique | ForEach-Object { Add-Content -Encoding UTF8 $out "- $_" }
  Add-VerificationResult $ProjectRoot "report-integrity" "HARD_FAIL" "$($issues.Count) integrity issue(s)" $out
  Write-LaneResult $ProjectRoot "report-integrity" "HARD_FAIL" @() @((Get-RelativeEvidencePath $ProjectRoot $out)) $issues @("Fix report/manifest integrity before final acceptance.")
  Write-Host "ERROR: report-integrity failed"
} else {
  Add-VerificationResult $ProjectRoot "report-integrity" "PASS" "Reports and evidence manifest look consistent" $out
  Write-LaneResult $ProjectRoot "report-integrity" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $out),(Get-RelativeEvidencePath $ProjectRoot $p.MachineSummary)) @() @()
  Write-Host "[PASS] report-integrity"
}
