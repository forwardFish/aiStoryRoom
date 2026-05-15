param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$Mode = "fast",
  [string]$ApiBase = "http://localhost:3001/api",
  [string]$WebUrl = "http://localhost:5177"
)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
$p = Get-AEPaths $ProjectRoot
$log = Join-Path $p.Logs "web-cabin-smoke.log"
$summary = Join-Path $p.Summaries "web-cabin-smoke.md"
$htmlEvidence = Join-Path $p.Screenshots "web-cabin-index.html"
$appEvidence = Join-Path $p.Logs "web-cabin-app-js.txt"
"# Web Cabin Smoke`nStarted: $(Get-Date)`n" | Set-Content -Encoding UTF8 $summary
"Web cabin smoke started $(Get-Date)" | Set-Content -Encoding UTF8 $log

function Log($Text) { Add-Content -Encoding UTF8 $log $Text; Write-Host $Text }
function Stop-Tree($Proc) {
  if ($null -ne $Proc -and -not $Proc.HasExited) {
    try { & taskkill.exe /PID $Proc.Id /T /F | Out-Null } catch { try { Stop-Process -Id $Proc.Id -Force } catch {} }
  }
}
function Wait-Http($Url, $Seconds = 25) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $last = $null
  while ((Get-Date) -lt $deadline) {
    try { return Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 } catch { $last = $_.Exception.Message; Start-Sleep -Milliseconds 500 }
  }
  throw "Timed out waiting for $Url. Last error: $last"
}

$indexPath = Join-Path $ProjectRoot "apps\web\public\index.html"
$appPath = Join-Path $ProjectRoot "apps\web\public\app.js"
$pkgPath = Join-Path $ProjectRoot "package.json"
if (!(Test-Path $indexPath)) { Add-Blocker $ProjectRoot "web-cabin-smoke" "HARD_FAIL" "apps/web/public/index.html missing"; exit 0 }
if (!(Test-Path $appPath)) { Add-Blocker $ProjectRoot "web-cabin-smoke" "HARD_FAIL" "apps/web/public/app.js missing"; exit 0 }
$scripts = Read-PackageScripts $pkgPath
if (!$scripts.ContainsKey("dev:web")) { Add-Blocker $ProjectRoot "web-cabin-smoke" "HARD_FAIL" "root package.json missing dev:web"; exit 0 }
if (!$scripts.ContainsKey("dev:preview-api")) { Add-Blocker $ProjectRoot "web-cabin-smoke" "HARD_FAIL" "root package.json missing dev:preview-api"; exit 0 }

$preview = $null
$web = $null
try {
  $previewOut = Join-Path $p.Logs "web-cabin-preview-api.out.log"
  $previewErr = Join-Path $p.Logs "web-cabin-preview-api.err.log"
  $webOut = Join-Path $p.Logs "web-cabin-web.out.log"
  $webErr = Join-Path $p.Logs "web-cabin-web.err.log"
  $preview = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev:preview-api" -WorkingDirectory $ProjectRoot -RedirectStandardOutput $previewOut -RedirectStandardError $previewErr -PassThru -WindowStyle Hidden
  $web = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev:web" -WorkingDirectory $ProjectRoot -RedirectStandardOutput $webOut -RedirectStandardError $webErr -PassThru -WindowStyle Hidden
  Log "Started preview-api PID=$($preview.Id), web PID=$($web.Id)"
  $apiResp = Wait-Http $ApiBase 30
  $webResp = Wait-Http $WebUrl 30
  $jsResp = Wait-Http "$WebUrl/app.js" 15
  $apiResp.Content | Out-File -Encoding UTF8 (Join-Path $p.Logs "web-cabin-api-root.json")
  $webResp.Content | Out-File -Encoding UTF8 $htmlEvidence
  $jsResp.Content | Out-File -Encoding UTF8 $appEvidence
  if ([string]::IsNullOrWhiteSpace($webResp.Content) -or [string]::IsNullOrWhiteSpace($jsResp.Content)) { throw "index.html or app.js returned empty" }
  if (-not $webResp.Content.Contains("web-cabin-root")) { throw "Web cabin root marker not found in HTML" }

  $env:WEB_CABIN_URL = $WebUrl
  $env:PREVIEW_API_BASE = $ApiBase
  $env:WEB_CABIN_OUT_DIR = $p.Docs
  $nodeScript = Join-Path $PSScriptRoot "web-cabin-smoke-cdp.mjs"
  $browserLog = Join-Path $p.Logs "web-cabin-browser.log"
  & node $nodeScript *>&1 | Tee-Object -FilePath $browserLog
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    try {
      & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-web-cabin-visual-diff.ps1") -ProjectRoot $ProjectRoot -Mode $Mode
    } catch {
      Add-Content -Encoding UTF8 $summary "`n- Visual diff invocation: HARD_FAIL - $($_.Exception.Message)`n"
      Add-Blocker $ProjectRoot "web-cabin-visual-diff" "HARD_FAIL" "Visual diff invocation failed: $($_.Exception.Message)"
    }
    Add-Content -Encoding UTF8 $summary "`n- Status: PASS`n- Preview API: $ApiBase`n- Web URL: $WebUrl`n- HTML evidence: $htmlEvidence`n- Screenshot: docs/auto-execute/screenshots/web-cabin-smoke.png`n- Browser summary: docs/auto-execute/logs/web-cabin-browser-summary.json`n"
    Add-VerificationResult $ProjectRoot "web-cabin-smoke" "PASS" "Preview API + apps/web + Chrome CDP core interactions completed" $summary
    Write-LaneResult $ProjectRoot "web-cabin-smoke" "PASS" @(@{ command="powershell -ExecutionPolicy Bypass -File .\scripts\acceptance\run-web-cabin-smoke.ps1 -Mode $Mode"; status="PASS"; log=Get-RelativeEvidencePath $ProjectRoot $browserLog }) @((Get-RelativeEvidencePath $ProjectRoot $summary),"docs/auto-execute/screenshots/web-cabin-smoke.png","docs/auto-execute/logs/web-cabin-browser-summary.json","docs/auto-execute/results/web-cabin-visual-diff.json","docs/auto-execute/results/web-cabin-structure-check.json") @() @()
  } elseif ($code -eq 2) {
    Add-Content -Encoding UTF8 $summary "`n- Status: MANUAL_REVIEW_REQUIRED`n- Reason: Browser automation unavailable, HTTP/static/API smoke passed.`n- Manual URL: $WebUrl`n"
    Add-VerificationResult $ProjectRoot "web-cabin-smoke" "MANUAL_REVIEW_REQUIRED" "HTTP/static/API smoke passed but browser automation unavailable" $summary
    Add-Blocker $ProjectRoot "web-cabin-smoke" "MANUAL_REVIEW_REQUIRED" "Open $WebUrl and run the listed flow manually."
    Write-LaneResult $ProjectRoot "web-cabin-smoke" "MANUAL_REVIEW_REQUIRED" @() @((Get-RelativeEvidencePath $ProjectRoot $summary),$htmlEvidence,$appEvidence) @("Browser automation unavailable") @("Open $WebUrl and run the listed flow manually.")
  } else {
    Add-Content -Encoding UTF8 $summary "`n- Status: HARD_FAIL`n- Browser automation failed; see $browserLog`n"
    Add-VerificationResult $ProjectRoot "web-cabin-smoke" "HARD_FAIL" "Browser automation failed" $browserLog
    Add-Blocker $ProjectRoot "web-cabin-smoke" "HARD_FAIL" "Browser automation failed; see docs/auto-execute/logs/web-cabin-browser.log"
    Write-LaneResult $ProjectRoot "web-cabin-smoke" "HARD_FAIL" @() @((Get-RelativeEvidencePath $ProjectRoot $summary),(Get-RelativeEvidencePath $ProjectRoot $browserLog)) @("Browser automation failed") @("Repair apps/web/preview-api flow and rerun web cabin smoke.")
  }
} catch {
  Log "ERROR: $($_.Exception.Message)"
  Add-Content -Encoding UTF8 $summary "`n- Status: HARD_FAIL`n- Error: $($_.Exception.Message)`n"
  Add-VerificationResult $ProjectRoot "web-cabin-smoke" "HARD_FAIL" $_.Exception.Message $log
  Add-Blocker $ProjectRoot "web-cabin-smoke" "HARD_FAIL" $_.Exception.Message
  Write-LaneResult $ProjectRoot "web-cabin-smoke" "HARD_FAIL" @() @((Get-RelativeEvidencePath $ProjectRoot $summary),(Get-RelativeEvidencePath $ProjectRoot $log)) @($_.Exception.Message) @("Repair web cabin smoke failure and rerun.")
} finally {
  Stop-Tree $web
  Stop-Tree $preview
}
