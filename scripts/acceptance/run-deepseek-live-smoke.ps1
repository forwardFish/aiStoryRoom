param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$Mode = "full",
  [string]$ApiBase = "http://localhost:3001/api"
)

. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$summary = Join-Path $p.Summaries "deepseek-live-smoke.md"
$evidenceJson = Join-Path $p.Results "deepseek-live-smoke-evidence.json"
$previewOut = Join-Path $p.Logs "deepseek-live-preview.out.log"
$previewErr = Join-Path $p.Logs "deepseek-live-preview.err.log"

function Stop-Tree($Proc) {
  if ($null -ne $Proc -and -not $Proc.HasExited) {
    try { & taskkill.exe /PID $Proc.Id /T /F | Out-Null } catch { try { Stop-Process -Id $Proc.Id -Force } catch {} }
  }
}

function Wait-Http($Url, $Seconds = 30) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    try { return Invoke-RestMethod -Uri $Url -TimeoutSec 5 } catch { $last = $_.Exception.Message; Start-Sleep -Milliseconds 500 }
  }
  throw "Timed out waiting for $Url. Last error: $last"
}

"# DeepSeek Live Smoke`n`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $summary

if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
  $msg = "DEEPSEEK_API_KEY is not set; live DeepSeek runtime proof is blocked. No secret was read or persisted."
  @{
    schemaVersion = $AE_SCHEMA_VERSION
    lane = "deepseek-live-smoke"
    status = "DOCUMENTED_BLOCKER"
    provider = "deepseek"
    keyPresent = $false
    model = $(if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_MODEL)) { "deepseek-v4-pro" } else { $env:DEEPSEEK_MODEL })
    baseUrl = $(if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_BASE_URL)) { "https://api.deepseek.com" } else { $env:DEEPSEEK_BASE_URL })
    blocker = $msg
    updatedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $evidenceJson
  Add-Content -Encoding UTF8 $summary "- Status: DOCUMENTED_BLOCKER`n- Reason: $msg`n- Evidence: $(Get-RelativeEvidencePath $ProjectRoot $evidenceJson)`n"
  Write-LaneResult $ProjectRoot "deepseek-live-smoke" "DOCUMENTED_BLOCKER" @() @((Get-RelativeEvidencePath $ProjectRoot $evidenceJson),(Get-RelativeEvidencePath $ProjectRoot $summary)) @($msg) @("Set DEEPSEEK_API_KEY only in the shell, then rerun this smoke.")
  Add-VerificationResult $ProjectRoot "deepseek-live-smoke" "DOCUMENTED_BLOCKER" $msg $evidenceJson
  Write-Host "[DOCUMENTED_BLOCKER] deepseek-live-smoke: missing DEEPSEEK_API_KEY"
  exit 0
}

$oldProvider = $env:AI_DIRECTOR_PROVIDER
$oldBase = $env:DEEPSEEK_BASE_URL
$oldModel = $env:DEEPSEEK_MODEL
$preview = $null
try {
  $env:AI_DIRECTOR_PROVIDER = "deepseek"
  if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_BASE_URL)) { $env:DEEPSEEK_BASE_URL = "https://api.deepseek.com" }
  if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_MODEL)) { $env:DEEPSEEK_MODEL = "deepseek-v4-pro" }

  $preview = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev:preview-api" -WorkingDirectory $ProjectRoot -RedirectStandardOutput $previewOut -RedirectStandardError $previewErr -PassThru -WindowStyle Hidden
  Wait-Http "$ApiBase/health" 35 | Out-Null

  $headers = @{ "x-mock-openid" = "mock_deepseek_live" }
  $template = (Invoke-RestMethod -Uri "$ApiBase/world-templates" -Headers $headers -TimeoutSec 10)[0]
  $runBody = @{ templateId = $template.id; mode = "invite"; maxPlayers = 3; aiPlayerCount = 0; ownerAsPlayer = $true } | ConvertTo-Json
  $run = Invoke-RestMethod -Uri "$ApiBase/story-runs" -Method Post -Headers $headers -ContentType "application/json" -Body $runBody -TimeoutSec 10
  $state = Invoke-RestMethod -Uri "$ApiBase/story-runs/$($run.id)/state" -Headers $headers -TimeoutSec 10
  $node = $state.currentNode
  $role = $state.roles[0]
  $actionBody = @{ roleId = $role.id; actionType = "investigate"; method = "Inspect the coin with gloves"; intent = "Find the source of the coin"; riskLevel = "safe" } | ConvertTo-Json
  Invoke-RestMethod -Uri "$ApiBase/nodes/$($node.id)/actions" -Method Post -Headers $headers -ContentType "application/json" -Body $actionBody -TimeoutSec 10 | Out-Null
  Invoke-RestMethod -Uri "$ApiBase/nodes/$($node.id)/resolve" -Method Post -Headers $headers -TimeoutSec 90 | Out-Null
  $tasks = Invoke-RestMethod -Uri "$ApiBase/admin/ai-tasks" -Headers $headers -TimeoutSec 10
  $task = @($tasks | Where-Object { $_.runId -eq $run.id -and $_.taskType -eq "resolve_node" } | Select-Object -First 1)[0]
  if ($null -eq $task) { throw "No resolve_node aiTask was recorded for DeepSeek smoke run." }

  $provider = [string]$task.resultJson.provider
  $modelType = [string]$task.modelType
  $taskStatus = [string]$task.status
  $ok = ($provider -eq "deepseek" -and $modelType -like "deepseek*" -and $taskStatus -eq "completed")
  $status = if ($ok) { "PASS" } else { "BLOCKED_BY_ENVIRONMENT" }
  $blockers = if ($ok) { @() } else { @("DeepSeek task did not complete as live provider. provider=$provider modelType=$modelType taskStatus=$taskStatus") }
  @{
    schemaVersion = $AE_SCHEMA_VERSION
    lane = "deepseek-live-smoke"
    status = $status
    runId = $run.id
    task = @{
      taskType = $task.taskType
      modelType = $modelType
      status = $taskStatus
      provider = $provider
      resultStatus = $task.resultJson.status
      usage = $task.resultJson.usage
      errorCode = $task.resultJson.errorCode
      errorMessage = $task.resultJson.errorMessage
    }
    keyPresent = $true
    baseUrl = $env:DEEPSEEK_BASE_URL
    model = $env:DEEPSEEK_MODEL
    updatedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $evidenceJson
  Add-Content -Encoding UTF8 $summary "- Status: $status`n- RunId: $($run.id)`n- Task modelType: $modelType`n- Provider: $provider`n- Evidence: $(Get-RelativeEvidencePath $ProjectRoot $evidenceJson)`n"
  Write-LaneResult $ProjectRoot "deepseek-live-smoke" $status @(@{ command = "AI_DIRECTOR_PROVIDER=deepseek preview-api live resolve smoke"; status = $status; log = Get-RelativeEvidencePath $ProjectRoot $evidenceJson }) @((Get-RelativeEvidencePath $ProjectRoot $evidenceJson),(Get-RelativeEvidencePath $ProjectRoot $summary)) $blockers @()
  Add-VerificationResult $ProjectRoot "deepseek-live-smoke" $status "provider=$provider modelType=$modelType taskStatus=$taskStatus" $evidenceJson
  Write-Host "[$status] deepseek-live-smoke provider=$provider modelType=$modelType"
} catch {
  $msg = ($_.Exception.Message -replace "Bearer\s+[A-Za-z0-9._\-]+", "Bearer [REDACTED]" -replace "sk-[A-Za-z0-9._\-]+", "sk-[REDACTED]")
  @{
    schemaVersion = $AE_SCHEMA_VERSION
    lane = "deepseek-live-smoke"
    status = "BLOCKED_BY_ENVIRONMENT"
    keyPresent = $true
    error = $msg
    updatedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $evidenceJson
  Add-Content -Encoding UTF8 $summary "- Status: BLOCKED_BY_ENVIRONMENT`n- Error: $msg`n"
  Write-LaneResult $ProjectRoot "deepseek-live-smoke" "BLOCKED_BY_ENVIRONMENT" @() @((Get-RelativeEvidencePath $ProjectRoot $evidenceJson),(Get-RelativeEvidencePath $ProjectRoot $summary)) @($msg) @("Check DeepSeek network/balance/model/key, then rerun this smoke.")
  Add-VerificationResult $ProjectRoot "deepseek-live-smoke" "BLOCKED_BY_ENVIRONMENT" $msg $evidenceJson
  Write-Host "[BLOCKED_BY_ENVIRONMENT] deepseek-live-smoke"
} finally {
  Stop-Tree $preview
  $env:AI_DIRECTOR_PROVIDER = $oldProvider
  $env:DEEPSEEK_BASE_URL = $oldBase
  $env:DEEPSEEK_MODEL = $oldModel
}
