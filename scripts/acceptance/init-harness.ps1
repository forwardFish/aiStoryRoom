param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string[]]$RequirementDocs = @(),
  [string[]]$UIReferences = @(),
  [string]$OutputHarnessYml = ""
)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
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

function ConvertTo-YamlList([string[]]$Items) {
  if ($Items.Count -eq 0) { return "[]" }
  return "`n" + (($Items | ForEach-Object { "    - ""$($_ -replace '"','\"')""" }) -join "`n")
}

$resolvedRequirementDocs = Resolve-ExistingPathList $RequirementDocs
$resolvedUIReferences = Resolve-ExistingPathList $UIReferences
$harnessPath = if ([string]::IsNullOrWhiteSpace($OutputHarnessYml)) { $p.HarnessConfig } else { Resolve-ProjectEvidencePath $ProjectRoot $OutputHarnessYml }

if (!(Test-Path -LiteralPath $harnessPath)) {
@"
project:
  name: $(Split-Path $ProjectRoot -Leaf)
  root: $ProjectRoot

docs:
  requirements: $(ConvertTo-YamlList $resolvedRequirementDocs)
  ui: $(ConvertTo-YamlList $resolvedUIReferences)

lanes:
  intake:
    enabled: true
  requirements:
    enabled: true
  frontend:
    enabled: true
  backend:
    enabled: true
  contract:
    enabled: true
  visual:
    enabled: true
  integration:
    enabled: true
  reportIntegrity:
    enabled: true
  secretGuard:
    enabled: true

commands:
  install: ""
  lint: ""
  typecheck: ""
  test: ""
  build: ""
  smoke: ""
  acceptance: ""

safety:
  allowCommit: false
  allowPush: false
  allowDeploy: false
  allowProductionDb: false
  allowPayment: false
"@ | Set-Content -Encoding UTF8 $harnessPath
} elseif ($resolvedRequirementDocs.Count -gt 0 -or $resolvedUIReferences.Count -gt 0) {
  $docsForHarness = if ($resolvedRequirementDocs.Count -gt 0) { $resolvedRequirementDocs } else { Get-HarnessListValue $ProjectRoot "docs" "requirements" }
  $uiForHarness = if ($resolvedUIReferences.Count -gt 0) { $resolvedUIReferences } else { Get-HarnessListValue $ProjectRoot "docs" "ui" }
  $existing = Get-Content -LiteralPath $harnessPath
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
}

if ($harnessPath -ne $p.HarnessConfig -and !(Test-Path -LiteralPath $p.HarnessConfig)) {
  Copy-Item -LiteralPath $harnessPath -Destination $p.HarnessConfig -Force
}

$templates = @{
  "00-environment-snapshot.md" = "# Environment Snapshot`n"
  "00-project-intake.md" = "# Project Intake`n`nProject root: $ProjectRoot`n"
  "01-task-decomposition.md" = "# Task Decomposition`n"
  "02-requirement-traceability-matrix.md" = "# Requirement Traceability Matrix`n`n| ID | Requirement | Source | Priority | Target | Acceptance | Evidence | Status | Notes |`n|---|---|---|---|---|---|---|---|---|`n"
  "03-surface-map.md" = "# Surface Map`n"
  "04-contract-map.md" = "# Contract Map`n`n| ID | Endpoint/service | Method | Frontend caller | Request body | Response shape | Auth/session | Error shape | Loading state | Empty state | Test evidence | Status |`n|---|---|---|---|---|---|---|---|---|---|---|---|`n"
  "04-visual-acceptance-checklist.md" = "# Visual Acceptance Checklist`n"
  "05-known-gaps-and-assumptions.md" = "# Known Gaps and Assumptions`n"
  "06-scope-classification.md" = "# Scope Classification`n`n| ID | Requirement | Classification | Reason | Evidence | Status |`n|---|---|---|---|---|---|`n"
  "06-test-matrix.md" = "# Test Matrix`n"
  "07-decision-log.md" = "# Decision Log`n`n| Time | Decision | Reason | Source/evidence | Impact |`n|---|---|---|---|---|`n"
  "07-acceptance-test-plan.md" = "# Acceptance Test Plan`n"
  "08-repair-log.md" = "# Repair Log`n"
  "gap-closure-log.md" = "# Gap Closure Log`n`n| Time | Round | Gap ID | Type | Severity | Closure basis | Evidence |`n|---|---|---|---|---|---|---|`n"
  "next-agent-action.md" = "# Next Agent Action`n`nNo repair action is pending.`n"
  "09-code-review.md" = "# Code Review`n"
  "10-agent-mistake-log.md" = "# Agent Mistake Log`n"
  "11-harness-improvement-log.md" = "# Harness Improvement Log`n"
  "12-fullstack-delivery-plan.md" = "# Full-Stack Delivery Plan`n`n| ID | Lane | Task | Target files | Depends on | Verification | Status | Evidence |`n|---|---|---|---|---|---|---|---|`n| FS-000 | intake | Read repo instructions, requirement docs, UI references, and existing architecture | AGENTS.md, docs, source tree | none | project intake exists | pending | docs/auto-execute/00-project-intake.md |`n| FS-010 | requirements | Convert PRD/UI into acceptance criteria and traceability | docs/auto-execute | FS-000 | matrix covers P0/P1 requirements | pending | docs/auto-execute/02-requirement-traceability-matrix.md |`n| FS-020 | frontend | Implement screens/routes/components/states required by UI | frontend/app/src/components | FS-010 | frontend build/tests/visual evidence | pending | docs/auto-execute/logs |`n| FS-030 | backend | Implement APIs/services/data behavior required by PRD | backend/server/api/src | FS-010 | backend build/tests/API smoke | pending | docs/auto-execute/logs |`n| FS-040 | contract | Align frontend calls with backend routes, payloads, auth, and errors | frontend + backend | FS-020, FS-030 | contract/API smoke evidence | pending | docs/auto-execute/13-frontend-backend-contract-map.md |`n| FS-050 | frontend-test | Run frontend-only verification | frontend | FS-020 | lint/typecheck/test/build pass or documented blocker | pending | docs/auto-execute/logs |`n| FS-060 | backend-test | Run backend-only verification | backend | FS-030 | build/test/API pass or documented blocker | pending | docs/auto-execute/logs |`n| FS-070 | integrated-test | Run full-flow/integrated verification | full stack | FS-040, FS-050, FS-060 | full-flow smoke/E2E evidence | pending | docs/auto-execute/FULL_FLOW_ACCEPTANCE.md |`n| FS-080 | review | Review implementation against PRD/UI/evidence | changed files | FS-070 | code review recorded | pending | docs/auto-execute/09-code-review.md |`n"
  "13-frontend-backend-contract-map.md" = "# Frontend/Backend Contract Map`n`n| ID | UI surface/component | Frontend action/call | Backend endpoint/service | Request shape | Response shape | Auth/session | Loading/empty/error/success states | Status | Evidence |`n|---|---|---|---|---|---|---|---|---|---|`n"
  "14-frontend-implementation-plan.md" = "# Frontend Implementation Plan`n`n| ID | UI reference | Screen/route/component | States | Data dependency | Acceptance check | Status | Evidence |`n|---|---|---|---|---|---|---|---|`n"
  "15-backend-implementation-plan.md" = "# Backend Implementation Plan`n`n| ID | Requirement | Endpoint/service/data model | Input | Output | Error/auth behavior | Acceptance check | Status | Evidence |`n|---|---|---|---|---|---|---|---|---|`n"
  "16-integrated-verification-plan.md" = "# Integrated Verification Plan`n`n| ID | Flow | Frontend entry | Backend/API dependency | Data setup | Command/manual check | Expected result | Status | Evidence |`n|---|---|---|---|---|---|---|---|---|`n"
  "17-final-acceptance-checklist.md" = "# Final Acceptance Checklist`n`n- [ ] PRD P0/P1 requirements mapped to implementation evidence.`n- [ ] UI references mapped to screens/components/states.`n- [ ] Frontend-only verification run or documented.`n- [ ] Backend-only verification run or documented.`n- [ ] Frontend/backend contract verification run or documented.`n- [ ] Integrated/full-flow verification run or documented.`n- [ ] Visual evidence captured or marked manual review.`n- [ ] Repair log updated for failed gates.`n- [ ] Code review recorded.`n- [ ] Final report written.`n"
  "18-acceptance-comparison-loop.md" = "# Acceptance Comparison Loop`n`nA delivery is complete only when one comparison round shows the implementation, requirement docs, UI references, contract map, tests, and evidence are aligned with no unresolved P0/P1 gaps.`n`n| Round | Result | Requirement alignment | UI alignment | Contract alignment | Test evidence | Remaining gaps | Next action | Evidence |`n|---|---|---|---|---|---|---|---|`n"
  "visual-diff-report.md" = "# Visual Diff Report`n`nNo visual diff has been run yet. Without screenshot diff evidence, do not claim UI pixel-perfect completion.`n"
  "final-convergence-report.md" = "# Final Convergence Report`n`nPending convergence loop.`n"
  "FULL_FLOW_ACCEPTANCE.md" = "# Full Flow Acceptance`n"
  "UI_REFERENCE_INVENTORY.md" = "# UI Reference Inventory`n"
  "QUALITY_GATES.md" = "# Quality Gates`n`n- PASS`n- PASS_WITH_LIMITATION`n- HARD_FAIL`n- IN_SCOPE_GAP`n- DOCUMENTED_BLOCKER`n- BLOCKED_BY_ENVIRONMENT`n- DEFERRED`n- MANUAL_REVIEW_REQUIRED`n- PRODUCT_DECISION_REQUIRED`n"
  "STATUS_SEMANTICS.md" = "# Status Semantics`n`n## PASS`nAll in-scope requirements, UI structure, contracts, tests, secret guard, and report integrity passed with evidence.`n`n## PASS_WITH_LIMITATION`nCore behavior passed, but acceptable limitations remain, such as non-pixel-perfect UI, production not verified, documented blockers, deferred out-of-scope items, or manual review requirements.`n`n## REPAIR_REQUIRED`nOpen in-scope gaps remain. The agent must read repair-plan.md and next-agent-action.md, edit implementation/tests/evidence, then rerun convergence.`n`n## HARD_FAIL`nBuild, test, core requirement, core UI, contract, secret, report integrity, or safety boundary failed.`n`n## BLOCKED`nProgress is blocked by credentials, environment, production resource, payment, destructive operation, or another non-code authority constraint.`n`n## DOCUMENTED_BLOCKER`nA known blocker is recorded with evidence. It is not an automatic code failure, but final verdict cannot be pure PASS.`n`n## DEFERRED`nExplicitly outside current scope and must include rationale.`n`n## MANUAL_REVIEW_REQUIRED`nHuman visual, product, or experience judgment is required. Do not claim fully automated PASS or pixel-perfect UI.`n`n## PRODUCT_DECISION_REQUIRED`nPRD, UI, or code behavior conflicts require product decision before pure PASS.`n"
  "GOLDEN_RULES.md" = "# Golden Rules`n`n- Do not fake pass.`n- Do not delete tests.`n- Do not invent undocumented APIs.`n- Do not access production services.`n- Do not run destructive git cleanup commands.`n"
  "AGENT_READABILITY.md" = "# Agent Readability`n`nStart with AGENTS.md, progress.md, feature_list.json, and run-all.ps1.`n"
  "verification-results.md" = "# Verification Results`n"
  "blockers.md" = "# Blockers`n"
  "progress.md" = "# Progress`n`nHarness initialized.`n"
}

foreach ($name in $templates.Keys) {
  $path = Join-Path $p.Docs $name
  if (!(Test-Path $path)) { $templates[$name] | Set-Content -Encoding UTF8 $path }
}

if (!(Test-Path -LiteralPath $p.AcceptanceGoal)) {
  @{
    projectRoot = $ProjectRoot
    schemaVersion = "1.3"
    status = "PENDING"
    completionStandard = @(
      "all in-scope PRD requirements PASS",
      "all required surfaces have evidence",
      "hard test gates pass or are documented blockers",
      "UI comparison PASS or accepted PASS_WITH_LIMITATION",
      "no HARD_FAIL",
      "no unresolved in-scope GAP",
      "report integrity and secret guard pass",
      "final report lists evidence paths"
    )
    uiPixelPerfectRule = "No screenshot diff evidence means no UI_PIXEL_PERFECT_PASS claim."
    generatedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.AcceptanceGoal
}
if (!(Test-Path -LiteralPath $p.RequirementCandidates)) {
  @{ schemaVersion = "1.3"; candidates = @(); generatedAt = (Get-Date).ToString("s"); status = "EMPTY"; note = "Auto-extracted candidates only. Normalize into requirement-target.json before final convergence." } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.RequirementCandidates
}
if (!(Test-Path -LiteralPath $p.RequirementTarget)) {
  @{ schemaVersion = "1.3"; requirements = @(); generatedAt = (Get-Date).ToString("s"); status = "PENDING" } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.RequirementTarget
}
if (!(Test-Path -LiteralPath $p.UiTarget)) {
  @{ schemaVersion = "1.3"; screens = @(); generatedAt = (Get-Date).ToString("s"); status = "PENDING"; pixelPerfectAllowed = $false } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.UiTarget
}
if (!(Test-Path -LiteralPath $p.SurfaceTarget)) {
  @{ surfaces = @(); generatedAt = (Get-Date).ToString("s"); status = "PENDING" } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.SurfaceTarget
}

$featureList = Join-Path $p.Features "feature_list.json"
if (!(Test-Path $featureList)) {
  $data = @{
    project = (Split-Path $ProjectRoot -Leaf)
    schemaVersion = "0.1"
    generatedAt = (Get-Date).ToString("s")
    features = @(
      @{
        id = "FE-HARNESS-001"
        category = "harness"
        priority = "P0"
        description = "Harness is initialized and run-all fast mode has been executed"
        source = "docs/auto-execute"
        surface = "harness"
        relatedFiles = @("docs/auto-execute","scripts/acceptance")
        requiredGates = @("init-harness","run-all-fast")
        evidenceRequired = @("verification-results.md","AUTO_EXECUTE_DELIVERY_REPORT.md")
        passes = $false
        evidence = @()
        notes = ""
      },
      @{
        id = "FS-010"
        category = "requirements"
        priority = "P0"
        description = "Convert requirement docs and UI references into acceptance criteria"
        source = "PRD/docs/UI"
        surface = "docs/auto-execute"
        relatedFiles = @("docs/auto-execute/02-requirement-traceability-matrix.md","docs/auto-execute/04-visual-acceptance-checklist.md")
        requiredGates = @("acceptance-pack")
        evidenceRequired = @("02-requirement-traceability-matrix.md")
        passes = $false
        evidence = @()
        notes = ""
      },
      @{
        id = "FS-020"
        category = "frontend"
        priority = "P0"
        description = "Implement UI screens/routes/components and states from the UI references"
        source = "UI references"
        surface = "frontend"
        relatedFiles = @("docs/auto-execute/14-frontend-implementation-plan.md")
        requiredGates = @("frontend-build","frontend-test","visual-smoke")
        evidenceRequired = @("frontend logs","screenshots")
        passes = $false
        evidence = @()
        notes = ""
      },
      @{
        id = "FS-030"
        category = "backend"
        priority = "P0"
        description = "Implement backend APIs/services/data behavior required by the PRD"
        source = "Requirement docs"
        surface = "backend"
        relatedFiles = @("docs/auto-execute/15-backend-implementation-plan.md")
        requiredGates = @("backend-build","backend-test","api-smoke")
        evidenceRequired = @("backend logs","API smoke")
        passes = $false
        evidence = @()
        notes = ""
      },
      @{
        id = "FS-040"
        category = "contract"
        priority = "P0"
        description = "Align frontend API calls with backend routes, request/response shape, auth, and errors"
        source = "frontend/backend code"
        surface = "contract"
        relatedFiles = @("docs/auto-execute/13-frontend-backend-contract-map.md")
        requiredGates = @("api-smoke","integration-smoke")
        evidenceRequired = @("contract map","smoke logs")
        passes = $false
        evidence = @()
        notes = ""
      },
      @{
        id = "FS-050"
        category = "integration"
        priority = "P0"
        description = "Run full-stack integrated verification for the implemented product flows"
        source = "PRD/UI acceptance criteria"
        surface = "full-flow"
        relatedFiles = @("docs/auto-execute/16-integrated-verification-plan.md","docs/auto-execute/FULL_FLOW_ACCEPTANCE.md")
        requiredGates = @("full-flow-smoke","e2e")
        evidenceRequired = @("full-flow report")
        passes = $false
        evidence = @()
        notes = ""
      },
      @{
        id = "FS-060"
        category = "review"
        priority = "P0"
        description = "Review diff against PRD/UI, tests, evidence, and false-completion risks"
        source = "changed files + docs/auto-execute"
        surface = "review"
        relatedFiles = @("docs/auto-execute/09-code-review.md","docs/AUTO_EXECUTE_DELIVERY_REPORT.md")
        requiredGates = @("code-review")
        evidenceRequired = @("09-code-review.md","AUTO_EXECUTE_DELIVERY_REPORT.md")
        passes = $false
        evidence = @()
        notes = ""
      }
    )
  }
  $data | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $featureList
}
if (!(Test-Path (Join-Path $p.Features "feature_status.json"))) {
  @{ updatedAt=(Get-Date).ToString("s"); statuses=@{} } | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 (Join-Path $p.Features "feature_status.json")
}
if (!(Test-Path (Join-Path $p.Features "current_feature.json"))) {
  @{ current=$null; updatedAt=(Get-Date).ToString("s") } | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 (Join-Path $p.Features "current_feature.json")
}

# UI inventory
$inventory = Join-Path $p.Docs "UI_REFERENCE_INVENTORY.md"
"# UI Reference Inventory`n" | Set-Content -Encoding UTF8 $inventory
foreach ($dir in @((Join-Path $ProjectRoot "docs\design\UI"), (Join-Path $ProjectRoot "docs\UI"))) {
  if (Test-Path $dir) {
    Add-Content -Encoding UTF8 $inventory "`n## $dir`n"
    Get-ChildItem $dir -Recurse -File -Include *.png,*.jpg,*.jpeg,*.webp,*.gif,*.html | ForEach-Object {
      Add-Content -Encoding UTF8 $inventory "- $($_.FullName)"
    }
  }
}

Update-State $ProjectRoot "init" "initialized" "Run scripts/acceptance/run-all.ps1 -Mode fast"
Add-VerificationResult $ProjectRoot "init-harness" "PASS" "Harness initialized" ""
Write-Host "[PASS] Harness initialized"
