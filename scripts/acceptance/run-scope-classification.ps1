param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$scope = Join-Path $p.Docs "06-scope-classification.md"
if (!(Test-Path -LiteralPath $scope)) {
  "# Scope Classification`n`n| ID | Requirement | Classification | Reason | Evidence | Status |`n|---|---|---|---|---|---|`n" | Set-Content -Encoding UTF8 $scope
}
$allowed = @("IN_SCOPE_MUST_CLOSE","IN_SCOPE_PASS_WITH_LIMITATION","DEFERRED_OUT_OF_SCOPE","PRODUCT_DECISION_REQUIRED","BLOCKED_BY_ENVIRONMENT")
Add-Content -Encoding UTF8 $scope "`nAllowed classifications: $($allowed -join ', ')`n"
Add-VerificationResult $ProjectRoot "scope-classification" "PASS" "Scope classification template available" $scope
Write-LaneResult $ProjectRoot "scope-classification" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $scope)) @() @("Classify every P0/P1 requirement before claiming final completion.")
Write-Host "[PASS] scope-classification"
