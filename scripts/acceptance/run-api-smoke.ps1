param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast", [string]$BaseUrl = "http://localhost:3001")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Summaries "api-smoke.md"
"# API Smoke`nBase URL: $BaseUrl`n" | Set-Content -Encoding UTF8 $out

function Stop-Tree($Proc) {
  if ($null -ne $Proc -and -not $Proc.HasExited) {
    try { & taskkill.exe /PID $Proc.Id /T /F | Out-Null } catch { try { Stop-Process -Id $Proc.Id -Force } catch {} }
  }
}
function Wait-Http($Url, $Seconds = 30) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    try { return Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 } catch { $last = $_.Exception.Message; Start-Sleep -Milliseconds 500 }
  }
  throw "Timed out waiting for $Url. Last error: $last"
}

$apiBase = $BaseUrl.TrimEnd("/")
if (-not $apiBase.EndsWith("/api")) { $apiBase = "$apiBase/api" }
$preview = $null
$commands = @()
$blockers = @()
try {
  $previewOut = Join-Path $p.Logs "api-smoke-preview-api.out.log"
  $previewErr = Join-Path $p.Logs "api-smoke-preview-api.err.log"
  $preview = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev:preview-api" -WorkingDirectory $ProjectRoot -RedirectStandardOutput $previewOut -RedirectStandardError $previewErr -PassThru -WindowStyle Hidden
  Wait-Http "$apiBase/health" 30 | Out-Null

  $checks = @(
    @{ method="GET"; path="/health"; body=$null },
    @{ method="GET"; path="/world-templates"; body=$null },
    @{ method="POST"; path="/auth/wechat-login"; body=@{ mockOpenid="mock_api_smoke_001"; nickname="API Smoke" } }
  )
  foreach ($ep in $checks) {
    $url = "$apiBase$($ep.path)"
    try {
      $start = Get-Date
      if ($null -ne $ep.body) {
        $resp = Invoke-WebRequest -Uri $url -Method $ep.method -UseBasicParsing -TimeoutSec 20 -ContentType "application/json" -Body ($ep.body | ConvertTo-Json -Depth 10)
      } else {
        $resp = Invoke-WebRequest -Uri $url -Method $ep.method -UseBasicParsing -TimeoutSec 20
      }
      $ms = [math]::Round(((Get-Date) - $start).TotalMilliseconds, 1)
      Add-Content -Encoding UTF8 $out "- $($ep.method) $url -> $($resp.StatusCode), $ms ms"
      Add-VerificationResult $ProjectRoot "api:$($ep.method) $($ep.path)" "PASS" "Status $($resp.StatusCode)" $out
      $commands += @{ command = "$($ep.method) $url"; status = "PASS"; log = Get-RelativeEvidencePath $ProjectRoot $out }
    } catch {
      Add-Content -Encoding UTF8 $out "ERROR: $($ep.method) $url failed: $($_.Exception.Message)"
      $commands += @{ command = "$($ep.method) $url"; status = "HARD_FAIL"; log = Get-RelativeEvidencePath $ProjectRoot $out }
      $blockers += "$($ep.method) $($ep.path): $($_.Exception.Message)"
    }
  }
} catch {
  $blockers += $_.Exception.Message
} finally {
  Stop-Tree $preview
}
$status = if ($blockers.Count -eq 0) { "PASS" } else { "HARD_FAIL" }
Add-VerificationResult $ProjectRoot "api-smoke" $status $(if ($status -eq "PASS") { "Preview API health/template/login smoke passed" } else { $blockers -join "; " }) $out
Write-LaneResult $ProjectRoot "api-smoke" $status $commands @((Get-RelativeEvidencePath $ProjectRoot $out)) $blockers @("Repair preview-api smoke failures before final acceptance.")
Write-Host "[$status] api-smoke"
