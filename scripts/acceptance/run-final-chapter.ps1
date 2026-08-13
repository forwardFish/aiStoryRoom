[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:TSX_TSCONFIG_PATH = 'apps/api/tsconfig.json'

function Invoke-CheckedStep {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  Write-Host "[pressure-final] $Name"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed ($LASTEXITCODE): $Name"
  }
}

Push-Location $repoRoot
try {
  Invoke-CheckedStep 'shared typecheck' {
    pnpm.cmd --filter '@ai-story/shared' typecheck
  }
  Invoke-CheckedStep 'templates typecheck' {
    pnpm.cmd --filter '@ai-story/templates' typecheck
  }
  Invoke-CheckedStep 'api typecheck' {
    pnpm.cmd --filter '@apps/api' typecheck
  }
  Invoke-CheckedStep 'focused pressure chapter tests' {
    node.exe --import tsx --test `
      apps/api/src/pressure-chapter/decision-automation/prisma-snapshot.api.spec.ts `
      apps/api/src/pressure-chapter/decision-automation/prisma-snapshot-hash.spec.ts `
      apps/api/src/pressure-chapter/decision-automation/prepared-action-batch.spec.ts `
      apps/api/src/pressure-chapter/decision-automation/decision-convergence.api.spec.ts `
      apps/api/src/pressure-chapter/decision-automation/decision-convergence-capability.api.spec.ts `
      apps/api/src/pressure-chapter/persistence/prepared-automation-action.prisma-adapter.api.spec.ts `
      apps/api/src/pressure-chapter/persistence/working-ledger.prisma-adapter.spec.ts `
      apps/api/src/pressure-chapter/orchestrator/chapter-orchestrator.spec.ts `
      apps/api/src/pressure-chapter/chapter-settlement/chapter-settlement.orchestrator.spec.ts `
      apps/api/src/pressure-chapter/game-projection/game-projection.service.spec.ts `
      apps/api/src/pressure-chapter/http/pressure-chapter-http.facade.spec.ts `
      apps/api/src/pressure-chapter/working-ledger/projection-cache.spec.ts `
      apps/api/src/pressure-chapter/integration/working-ledger.beat-plan.spec.ts `
      apps/api/src/pressure-chapter/projection-plan/authority-downstream.batch.api.spec.ts `
      apps/api/src/pressure-chapter/observability/pressure-db-metrics.spec.ts `
      apps/api/src/pressure-chapter/a-emotion-production/content-source.api.spec.ts `
      apps/api/src/pressure-chapter/sql7-fast-path/batch-planner.spec.ts `
      apps/api/src/pressure-chapter/sql7-fast-path/plan-builder.spec.ts `
      apps/api/src/pressure-chapter/sql7-fast-path/prisma-commit.spec.ts `
      apps/api/src/pressure-chapter/sql7-fast-path/prisma-snapshot.spec.ts `
      apps/api/src/pressure-chapter/sql7-fast-path/query-budget.spec.ts `
      apps/api/src/pressure-chapter/sql7-fast-path/service.spec.ts `
      apps/api/src/pressure-chapter/sql7-fast-path/settlement-planner.spec.ts `
      apps/api/src/pressure-chapter/live-adapters/live-adapters.api.spec.ts `
      scripts/acceptance/pressure-chapter/fixtures/local-auth-fixture.test.mjs
  }

  Write-Host '[pressure-final] PASS: typechecks and focused offline acceptance succeeded.'
}
finally {
  Pop-Location
}
