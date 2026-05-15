param([string]$ProjectRoot = (Get-Location).Path)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$failures = @()
$checks = @()
function Add-Check($Name, $Passed, $Details = "") {
  $script:checks += [PSCustomObject]@{ name=$Name; passed=[bool]$Passed; details=$Details }
  if (-not $Passed) { $script:failures += "${Name}: $Details" }
}

$requiredScripts = @(
  "init-harness.ps1",
  "run-all.ps1",
  "run-convergence.ps1",
  "run-final-gate.ps1",
  "run-acceptance-compare.ps1",
  "run-compare-requirements.ps1",
  "run-compare-ui.ps1",
  "run-gap-repair.ps1",
  "run-report-integrity.ps1",
  "run-secret-guard.ps1",
  "run-status.ps1",
  "test-harness.ps1"
)
foreach ($script in $requiredScripts) {
  Add-Check "script exists: $script" (Test-Path -LiteralPath (Join-Path $PSScriptRoot $script)) "missing script"
}

$tokens = $null
$parseErrors = $null
$allPs1 = Get-ChildItem -LiteralPath $PSScriptRoot -Filter *.ps1 -File -ErrorAction SilentlyContinue
foreach ($script in $allPs1) {
  $tokens = $null
  $parseErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$parseErrors)
  Add-Check "parse: $($script.Name)" ($null -eq $parseErrors -or $parseErrors.Count -eq 0) (($parseErrors | ForEach-Object { $_.Message }) -join "; ")
}

$runConvergenceText = Get-Content -LiteralPath (Join-Path $PSScriptRoot "run-convergence.ps1") -Raw
Add-Check "run-convergence supports MaxRounds default 5" ($runConvergenceText -match '\[int\]\$MaxRounds\s*=\s*5') "MaxRounds default is not 5"
Add-Check "run-convergence supports ResetConvergence" ($runConvergenceText -match '\[switch\]\$ResetConvergence') "ResetConvergence parameter missing"

$runAllText = Get-Content -LiteralPath (Join-Path $PSScriptRoot "run-all.ps1") -Raw
Add-Check "run-all supports fast/gate/full" ($runAllText -match 'ValidateSet\("fast","gate","full"\)') "Mode ValidateSet missing"
Add-Check "run-all supports SkipCompare" ($runAllText -match '\[switch\]\$SkipCompare') "SkipCompare parameter missing"
Add-Check "run-all supports SkipFinalGate" ($runAllText -match '\[switch\]\$SkipFinalGate') "SkipFinalGate parameter missing"
Add-Check "run-all does not write COMPLETED verdict" ($runAllText -notmatch '"COMPLETED"|''COMPLETED''') "COMPLETED still appears as a status"

Add-Check "exit code PASS" ((Get-AEExitCode "PASS") -eq 0) "PASS exit code must be 0"
Add-Check "exit code PASS_WITH_LIMITATION" ((Get-AEExitCode "PASS_WITH_LIMITATION") -eq 3) "PASS_WITH_LIMITATION exit code must be 3"
Add-Check "exit code REPAIR_REQUIRED" ((Get-AEExitCode "REPAIR_REQUIRED") -eq 2) "REPAIR_REQUIRED exit code must be 2"
Add-Check "exit code HARD_FAIL" ((Get-AEExitCode "HARD_FAIL") -eq 1) "HARD_FAIL exit code must be 1"
Add-Check "exit code BLOCKED" ((Get-AEExitCode "BLOCKED") -eq 4) "BLOCKED exit code must be 4"

$requiredDocs = @(
  "STATUS_SEMANTICS.md",
  "QUALITY_GATES.md",
  "GOLDEN_RULES.md"
)
foreach ($doc in $requiredDocs) {
  $docPath = Join-Path $p.Docs $doc
  if (!(Test-Path -LiteralPath $docPath)) {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "init-harness.ps1") -ProjectRoot $ProjectRoot | Out-Null
  }
  Add-Check "doc exists: $doc" (Test-Path -LiteralPath $docPath) "missing docs/auto-execute/$doc"
}

try {
  $machineProbe = Get-Content -LiteralPath $p.MachineSummary -Raw | ConvertFrom-Json
  $machineProbe | Add-Member -NotePropertyName testHarnessProbeAt -NotePropertyValue (Get-Date).ToString("s") -Force
  $machineProbe | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.MachineSummary
  Add-Check "machine-summary writable" $true ""
} catch {
  Add-Check "machine-summary writable" $false $_.Exception.Message
}

try {
  $gapProbe = Get-Content -LiteralPath $p.GapListJson -Raw | ConvertFrom-Json
  $gapProbe | Add-Member -NotePropertyName testHarnessProbeAt -NotePropertyValue (Get-Date).ToString("s") -Force
  $gapProbe | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.GapListJson
  Add-Check "gap-list writable" $true ""
} catch {
  Add-Check "gap-list writable" $false $_.Exception.Message
}

try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-report-integrity.ps1") -ProjectRoot $ProjectRoot -Mode fast | Out-Null
  Add-Check "report-integrity runnable" ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) "exit $LASTEXITCODE"
} catch {
  Add-Check "report-integrity runnable" $false $_.Exception.Message
}

try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-secret-guard.ps1") -ProjectRoot $ProjectRoot -Mode fast | Out-Null
  Add-Check "secret-guard runnable" ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 4 -or $null -eq $LASTEXITCODE) "exit $LASTEXITCODE"
} catch {
  Add-Check "secret-guard runnable" $false $_.Exception.Message
}

$statusPath = Join-Path $p.Results "test-harness.json"
@{
  schemaVersion = $AE_SCHEMA_VERSION
  lane = "test-harness"
  status = $(if ($failures.Count -eq 0) { "PASS" } else { "HARD_FAIL" })
  updatedAt = (Get-Date).ToString("s")
  checks = $checks
  failures = $failures
} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $statusPath

if ($failures.Count -eq 0) {
  Write-Host "[PASS] test-harness"
  exit 0
}

Write-Host "ERROR: test-harness found $($failures.Count) failure(s)"
$failures | ForEach-Object { Write-Host "- $_" }
exit 1
