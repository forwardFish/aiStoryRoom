param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot

if (-not (Get-HarnessLaneEnabled $ProjectRoot "contract" $true)) {
  Write-LaneResult $ProjectRoot "contract" "DEFERRED" @() @() @("contract lane disabled in harness.yml") @()
  Write-Host "[DEFERRED] contract"
  exit 0
}

$p = Get-AEPaths $ProjectRoot
$contract = Join-Path $p.Docs "04-contract-map.md"
if (!(Test-Path -LiteralPath $contract)) {
  "# Contract Map`n`n| ID | Endpoint/service | Method | Frontend caller | Request body | Response shape | Auth/session | Error shape | Loading state | Empty state | Test evidence | Status |`n|---|---|---|---|---|---|---|---|---|---|---|---|`n" | Set-Content -Encoding UTF8 $contract
}

$frontendCalls = @()
$apiDefs = @()
$files = Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx,*.dart,*.py -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\node_modules\\|\\.git\\|\\build\\|\\dist\\|\\.dart_tool\\" }
foreach ($file in $files) {
  try { $txt = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop } catch { continue }
  if ([string]::IsNullOrEmpty($txt)) { continue }
  $rel = Get-RelativeEvidencePath $ProjectRoot $file.FullName
  foreach ($m in [regex]::Matches($txt, '(fetch|axios\.[a-z]+|http\.(get|post|put|patch|delete))\s*\(?\s*["'']([^"'']+/[^"'']*)["'']')) {
    $frontendCalls += @{ file = $rel; call = $m.Groups[0].Value; path = $m.Groups[3].Value }
  }
  foreach ($m in [regex]::Matches($txt, '(Get|Post|Put|Patch|Delete)\(["'']([^"'']*)["'']\)|router\.(get|post|put|patch|delete)\(["'']([^"'']*)["'']')) {
    $apiDefs += @{ file = $rel; def = $m.Groups[0].Value }
  }
}

$out = Join-Path $p.Results "contract-discovery.json"
@{
  schemaVersion = $AE_SCHEMA_VERSION
  lane = "contract-discovery"
  status = $(if ($frontendCalls.Count -eq 0 -and $apiDefs.Count -eq 0) { "MANUAL_REVIEW_REQUIRED" } else { "PASS" })
  blockers = @()
  commands = @()
  evidence = @("docs\auto-execute\04-contract-map.md", "docs\auto-execute\13-frontend-backend-contract-map.md")
  nextActions = @("Keep 04-contract-map.md and 13-frontend-backend-contract-map.md aligned with frontend calls and backend API definitions.")
  frontendCalls=$frontendCalls
  apiDefinitions=$apiDefs
  generatedAt=(Get-Date).ToString("s")
} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $out
Add-EvidenceItem $ProjectRoot "api" $out "contract discovery"

if ($frontendCalls.Count -eq 0 -and $apiDefs.Count -eq 0) {
  Add-Blocker $ProjectRoot "contract" "MANUAL_REVIEW_REQUIRED" "No frontend calls or backend API definitions auto-detected"
  Write-LaneResult $ProjectRoot "contract" "MANUAL_REVIEW_REQUIRED" @() @((Get-RelativeEvidencePath $ProjectRoot $contract),(Get-RelativeEvidencePath $ProjectRoot $out)) @("No contracts auto-detected") @("Fill 04-contract-map.md manually or add tests that expose API contracts.")
  Write-Host "[MANUAL_REVIEW_REQUIRED] contract"
} else {
  Add-VerificationResult $ProjectRoot "contract" "PASS" "Contract discovery generated; agent must reconcile map with PRD/UI" $out
  Write-LaneResult $ProjectRoot "contract" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $contract),(Get-RelativeEvidencePath $ProjectRoot $out)) @() @("Review and complete 04-contract-map.md with request/response/auth/error states.")
  Write-Host "[PASS] contract discovery"
}
