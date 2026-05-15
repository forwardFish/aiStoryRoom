param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$review = Join-Path $p.Docs "09-code-review.md"
if (!(Test-Path -LiteralPath $review)) { "# Code Review`n" | Set-Content -Encoding UTF8 $review }
$txt = Get-Content -LiteralPath $review -Raw
if ($txt -match "Status:\s*PASS_WITH_LIMITATION|Status:\s*PASS") {
  Add-Content -Encoding UTF8 $review @("", "## $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "- Existing acceptance-oriented code review retained; no new blocking issue detected by this harness lane.", "")
  Add-VerificationResult $ProjectRoot "code-review" "PASS_WITH_LIMITATION" "Acceptance-oriented code review exists; non-blocking limitations are documented" $review
  Write-LaneResult $ProjectRoot "code-review" "PASS_WITH_LIMITATION" @() @((Get-RelativeEvidencePath $ProjectRoot $review)) @() @("Preserve manual final acceptance for UI pixel parity and commit scope.")
  Write-Host "[PASS_WITH_LIMITATION] code-review"
} else {
  Add-Content -Encoding UTF8 $review @("", "## $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", '- Automated placeholder: run `$code-review` or perform manual review against PRD/UI, contract map, verification results, secret guard, and report integrity before final acceptance.', "")
  Add-VerificationResult $ProjectRoot "code-review" "MANUAL_REVIEW_REQUIRED" 'Run OMX `$code-review` or perform human review' $review
  Write-LaneResult $ProjectRoot "code-review" "MANUAL_REVIEW_REQUIRED" @() @((Get-RelativeEvidencePath $ProjectRoot $review)) @("Code review requires agent/human review of current diff") @("Run `$code-review` on the diff and acceptance pack.")
  Write-Host "[MANUAL_REVIEW_REQUIRED] code-review"
}
