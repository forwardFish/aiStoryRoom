param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$Mode = "fast",
  [string[]]$RequirementDocs = @(),
  [string[]]$UIReferences = @(),
  [string]$OutputHarnessYml = ""
)

. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
$p = Get-AEPaths $ProjectRoot

function Resolve-ExistingPathList([string[]]$Items) {
  $resolved = @()
  foreach ($item in $Items) {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    $candidate = $item
    if (-not [System.IO.Path]::IsPathRooted($candidate)) {
      $candidate = Join-Path $ProjectRoot $candidate
    }
    if (Test-Path -LiteralPath $candidate) {
      $resolved += (Resolve-Path -LiteralPath $candidate).Path
    } else {
      $resolved += "[MISSING] $item"
    }
  }
  return $resolved
}

$resolvedDocs = Resolve-ExistingPathList $RequirementDocs
$resolvedUI = Resolve-ExistingPathList $UIReferences

if (!(Test-Path -LiteralPath $p.HarnessConfig)) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "init-harness.ps1") -ProjectRoot $ProjectRoot -RequirementDocs $RequirementDocs -UIReferences $UIReferences -OutputHarnessYml $OutputHarnessYml
} elseif ($resolvedDocs.Count -gt 0 -or $resolvedUI.Count -gt 0) {
  $harnessPath = if ([string]::IsNullOrWhiteSpace($OutputHarnessYml)) { $p.HarnessConfig } else { Resolve-ProjectEvidencePath $ProjectRoot $OutputHarnessYml }
  $docsForHarness = if ($resolvedDocs.Count -gt 0) { $resolvedDocs } else { Get-HarnessListValue $ProjectRoot "docs" "requirements" }
  $uiForHarness = if ($resolvedUI.Count -gt 0) { $resolvedUI } else { Get-HarnessListValue $ProjectRoot "docs" "ui" }
  $existing = Get-Content -LiteralPath $p.HarnessConfig
  $updated = New-Object System.Collections.Generic.List[string]
  $i = 0
  while ($i -lt $existing.Count) {
    if ($existing[$i] -match "^\s*docs\s*:\s*$") {
      $updated.Add("docs:")
      if (@($docsForHarness).Count -gt 0) {
        $updated.Add("  requirements:")
        foreach ($item in @($docsForHarness)) { $updated.Add("    - ""$item""") }
      } else {
        $updated.Add("  requirements: []")
      }
      if (@($uiForHarness).Count -gt 0) {
        $updated.Add("  ui:")
        foreach ($item in @($uiForHarness)) { $updated.Add("    - ""$item""") }
      } else {
        $updated.Add("  ui: []")
      }
      $i++
      while ($i -lt $existing.Count -and $existing[$i] -notmatch "^\S") { $i++ }
      continue
    }
    $updated.Add($existing[$i])
    $i++
  }
  $updated | Set-Content -Encoding UTF8 $harnessPath
  if ($harnessPath -ne $p.HarnessConfig) { Copy-Item -LiteralPath $harnessPath -Destination $p.HarnessConfig -Force }
}

$frontendCandidates = @("frontend", "apps\web", "web", "app", "client", "src")
$backendCandidates = @("backend", "server", "api", "apps\api", "services")
$frontendRoots = @()
$backendRoots = @()
foreach ($c in $frontendCandidates) {
  $d = Join-Path $ProjectRoot $c
  if ((Test-Path -LiteralPath (Join-Path $d "package.json")) -or (Test-Path -LiteralPath (Join-Path $d "pubspec.yaml")) -or (Test-Path -LiteralPath (Join-Path $d "src"))) {
    $frontendRoots += $d
  }
}
foreach ($c in $backendCandidates) {
  $d = Join-Path $ProjectRoot $c
  if ((Test-Path -LiteralPath (Join-Path $d "package.json")) -or (Test-Path -LiteralPath (Join-Path $d "pyproject.toml")) -or (Test-Path -LiteralPath (Join-Path $d "src"))) {
    $backendRoots += $d
  }
}

$plan = Join-Path $p.Docs "12-fullstack-delivery-plan.md"
@(
  "# Full-Stack Delivery Plan",
  "",
  "Generated: $(Get-Date)",
  "",
  "## Inputs",
  "",
  "Requirement docs:",
  $(if ($resolvedDocs.Count -gt 0) { $resolvedDocs | ForEach-Object { "- $_" } } else { "- auto-detect from docs/ or user prompt" }),
  "",
  "UI references:",
  $(if ($resolvedUI.Count -gt 0) { $resolvedUI | ForEach-Object { "- $_" } } else { "- auto-detect from docs/UI, docs/design/UI, screenshots, or user prompt" }),
  "",
  "Detected frontend roots:",
  $(if ($frontendRoots.Count -gt 0) { $frontendRoots | ForEach-Object { "- $_" } } else { "- none detected yet; agent must inspect repo" }),
  "",
  "Detected backend roots:",
  $(if ($backendRoots.Count -gt 0) { $backendRoots | ForEach-Object { "- $_" } } else { "- none detected yet; agent must inspect repo" }),
  "",
  "## Lane Tasks",
  "",
  "| ID | Lane | Task | Target files | Depends on | Verification | Status | Evidence |",
  "|---|---|---|---|---|---|---|---|",
  "| FS-000 | intake | Read AGENTS.md, project structure, PRD, UI references, package/build files | repo root, docs, UI refs | none | intake doc complete | pending | 00-project-intake.md |",
  "| FS-010 | requirements | Extract P0/P1 requirements and map them to acceptance criteria | docs/auto-execute | FS-000 | traceability matrix complete | pending | 02-requirement-traceability-matrix.md |",
  "| FS-020 | frontend | Implement screens/routes/components/states from UI | detected frontend roots | FS-010 | frontend build/test/visual evidence | pending | logs/screenshots |",
  "| FS-030 | backend | Implement APIs/services/data behavior from PRD | detected backend roots | FS-010 | backend build/test/API evidence | pending | logs |",
  "| FS-040 | contract | Align frontend calls with backend routes, payloads, auth, errors | frontend + backend | FS-020, FS-030 | contract/API smoke | pending | 13-frontend-backend-contract-map.md |",
  "| FS-050 | frontend-test | Run frontend-only checks | frontend | FS-020 | lint/typecheck/test/build | pending | logs |",
  "| FS-060 | backend-test | Run backend-only checks | backend | FS-030 | build/test/API | pending | logs |",
  "| FS-070 | integrated-test | Run end-to-end/full-flow checks | full stack | FS-040, FS-050, FS-060 | smoke/E2E/full-flow | pending | FULL_FLOW_ACCEPTANCE.md |",
  "| FS-080 | review | Review diff against PRD/UI/evidence | changed files | FS-070 | code review | pending | 09-code-review.md |"
) | Set-Content -Encoding UTF8 $plan

$contract = Join-Path $p.Docs "13-frontend-backend-contract-map.md"
if (!(Test-Path -LiteralPath $contract)) {
  @(
    "# Frontend/Backend Contract Map",
    "",
    "| ID | UI surface/component | Frontend action/call | Backend endpoint/service | Request shape | Response shape | Auth/session | Loading/empty/error/success states | Status | Evidence |",
    "|---|---|---|---|---|---|---|---|---|---|"
  ) | Set-Content -Encoding UTF8 $contract
}

Add-VerificationResult $ProjectRoot "plan-fullstack-delivery" "PASS" "Full-stack lane plan generated" $plan
Write-LaneResult $ProjectRoot "requirements" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $plan),(Get-RelativeEvidencePath $ProjectRoot $contract)) @() @("Fill requirement matrix and contract map from PRD/UI before final completion.")
Write-Host "[PASS] Full-stack delivery plan generated: $plan"
