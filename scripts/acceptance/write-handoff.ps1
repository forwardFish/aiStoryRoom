param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$Reason = "manual",
  [string]$NextCommand = ""
)

. "$PSScriptRoot\lib.ps1"

$ProjectRoot = Get-ProjectRoot $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$latestDir = Join-Path $p.Docs "latest"
Ensure-Dir $latestDir

$handoff = Join-Path $latestDir "HANDOFF.md"
$runIdFile = Join-Path $latestDir "run-id.txt"
$latestMachineSummary = Join-Path $latestDir "machine-summary.json"
$latestGapList = Join-Path $latestDir "gap-list.json"
$latestRepairPlan = Join-Path $latestDir "repair-plan.md"
$latestNextAction = Join-Path $latestDir "next-agent-action.md"
$latestVerification = Join-Path $latestDir "verification-results.md"
$latestBlockers = Join-Path $latestDir "blockers.md"

if (!(Test-Path -LiteralPath $runIdFile)) {
  $runId = "ae-{0}-{1}" -f (Get-Date -Format "yyyyMMddHHmmss"), ([guid]::NewGuid().ToString("N").Substring(0, 8))
  $runId | Set-Content -Encoding UTF8 $runIdFile
} else {
  $runId = (Get-Content -LiteralPath $runIdFile -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($runId)) {
    $runId = "ae-{0}-{1}" -f (Get-Date -Format "yyyyMMddHHmmss"), ([guid]::NewGuid().ToString("N").Substring(0, 8))
    $runId | Set-Content -Encoding UTF8 $runIdFile
  }
}

function Copy-AELatestFile([string]$Source, [string]$Target, [string]$DefaultContent) {
  Ensure-Dir (Split-Path -Parent $Target)
  if (Test-Path -LiteralPath $Source) {
    Copy-Item -LiteralPath $Source -Destination $Target -Force
  } elseif (!(Test-Path -LiteralPath $Target)) {
    $DefaultContent | Set-Content -Encoding UTF8 $Target
  }
}

Copy-AELatestFile $p.MachineSummary $latestMachineSummary "{}"
Copy-AELatestFile $p.GapListJson $latestGapList (@{ schemaVersion = $AE_SCHEMA_VERSION; gaps = @() } | ConvertTo-Json -Depth 20)
Copy-AELatestFile $p.RepairPlan $latestRepairPlan "# Repair Plan`n`nNo repair plan has been generated yet.`n"
Copy-AELatestFile $p.NextAgentAction $latestNextAction "# Next Agent Action`n`nNo repair action is pending.`n"
Copy-AELatestFile $p.Verification $latestVerification "# Verification Results`n"
Copy-AELatestFile $p.Blockers $latestBlockers "# Blockers`n"

try { $summary = Get-Content -LiteralPath $latestMachineSummary -Raw | ConvertFrom-Json } catch { $summary = $null }
try { $gapList = Get-Content -LiteralPath $latestGapList -Raw | ConvertFrom-Json } catch { $gapList = $null }
try { $state = Get-Content -LiteralPath $p.ConvergenceState -Raw | ConvertFrom-Json } catch { $state = $null }

$round = if ($null -ne $state -and $null -ne $state.currentRound) { [int]$state.currentRound } elseif ($null -ne $gapList -and $null -ne $gapList.round) { [int]$gapList.round } else { 0 }
$verdict = if ($null -ne $summary -and ![string]::IsNullOrWhiteSpace([string]$summary.finalVerdict)) { Normalize-AEVerdict $summary.finalVerdict } elseif ($null -ne $state -and ![string]::IsNullOrWhiteSpace([string]$state.finalVerdict)) { Normalize-AEVerdict $state.finalVerdict } else { "PENDING" }
$openGaps = @()
if ($null -ne $gapList -and $null -ne $gapList.gaps) {
  $openGaps = @($gapList.gaps) | Where-Object { $_.severity -in @("HARD_FAIL","IN_SCOPE_GAP") -and $_.status -ne "CLOSED" }
}

$blockerText = if (Test-Path -LiteralPath $latestBlockers) { Get-Content -LiteralPath $latestBlockers -Raw } else { "" }
$verificationText = if (Test-Path -LiteralPath $latestVerification) { Get-Content -LiteralPath $latestVerification -Raw } else { "" }
$summaryText = if (Test-Path -LiteralPath $latestMachineSummary) { Get-Content -LiteralPath $latestMachineSummary -Raw } else { "{}" }
$gapText = if (Test-Path -LiteralPath $latestGapList) { Get-Content -LiteralPath $latestGapList -Raw } else { "{}" }

$commands = @()
foreach ($file in Get-ChildItem -LiteralPath $p.Results -Filter *.json -ErrorAction SilentlyContinue) {
  try {
    $result = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    foreach ($command in @($result.commands)) {
      if (![string]::IsNullOrWhiteSpace([string]$command)) { $commands += [string]$command }
    }
  } catch {}
}
$commands = @($commands | Select-Object -Unique)
if ($commands.Count -eq 0) { $commands = @("See docs/auto-execute/latest/verification-results.md and docs/auto-execute/results/*.json.") }

$changedFiles = @()
try {
  Push-Location $ProjectRoot
  if (Test-CommandExists "git") {
    $changedFiles = @(git status --short 2>$null | ForEach-Object { [string]$_ } | Where-Object { ![string]::IsNullOrWhiteSpace($_) })
  }
} catch {
  $changedFiles = @("Unable to read git status: $($_.Exception.Message)")
} finally {
  try { Pop-Location } catch {}
}
if ($changedFiles.Count -eq 0) { $changedFiles = @("No git changes detected or project is not a git worktree.") }

$resumeCommand = "powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\resume-convergence.ps1 -ProjectRoot `"$ProjectRoot`" -Mode full -MaxRounds 5"
if ([string]::IsNullOrWhiteSpace($NextCommand)) {
  if ($verdict -eq "REPAIR_REQUIRED" -or $openGaps.Count -gt 0) {
    $NextCommand = "Read docs/auto-execute/latest/repair-plan.md and docs/auto-execute/latest/next-agent-action.md, repair implementation/tests/evidence, then run: $resumeCommand"
  } else {
    $NextCommand = $resumeCommand
  }
}

$allowContinueRepair = ($verdict -in @("REPAIR_REQUIRED","HARD_FAIL","FAIL","PENDING") -or $openGaps.Count -gt 0)
$prohibitReset = $true
$openGapLines = if ($openGaps.Count -gt 0) {
  @($openGaps | ForEach-Object { "- $($_.id) [$($_.severity)] $($_.description) Repair: $($_.repairTarget)" })
} else {
  @("- No open HARD_FAIL or IN_SCOPE_GAP recorded in latest gap-list.json.")
}
$commandLines = @($commands | ForEach-Object { "- $_" })
$changedLines = @($changedFiles | ForEach-Object { "- $_" })
$blockerExcerpt = if ([string]::IsNullOrWhiteSpace($blockerText)) { "No blockers recorded." } else { $blockerText.Trim() }

@"
# Auto Execute Handoff

GeneratedAt: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Reason: $Reason

## Current Run

- RunId: $runId
- ProjectRoot: $ProjectRoot
- Convergence round: $round
- Final verdict: $verdict
- Allow continue repair: $allowContinueRepair
- Prohibit ResetConvergence on resume: $prohibitReset

## Current State Files

- handoff: docs/auto-execute/latest/HANDOFF.md
- run-id: docs/auto-execute/latest/run-id.txt
- machine-summary: docs/auto-execute/latest/machine-summary.json
- gap-list: docs/auto-execute/latest/gap-list.json
- repair-plan: docs/auto-execute/latest/repair-plan.md
- next-agent-action: docs/auto-execute/latest/next-agent-action.md
- verification-results: docs/auto-execute/latest/verification-results.md
- blockers: docs/auto-execute/latest/blockers.md

## Open HARD_FAIL / IN_SCOPE_GAP

$($openGapLines -join "`r`n")

## Blockers

~~~text
$blockerExcerpt
~~~

## Commands Run

$($commandLines -join "`r`n")

## Modified Files

$($changedLines -join "`r`n")

## Next Command

~~~powershell
$NextCommand
~~~

## Resume Rule

Do NOT use -ResetConvergence when resuming the same run.

## Recovery Command

~~~powershell
$resumeCommand
~~~

## Repair Required Rule

If current verdict is REPAIR_REQUIRED:

1. Read docs/auto-execute/latest/repair-plan.md
2. Read docs/auto-execute/latest/next-agent-action.md
3. Modify implementation/tests/evidence
4. Re-run convergence through resume-convergence.ps1 without -ResetConvergence

## Current Machine Summary

~~~json
$summaryText
~~~

## Current Gap List

~~~json
$gapText
~~~

"@ | Set-Content -Encoding UTF8 $handoff

Write-Host "[PASS] handoff written: $handoff"
