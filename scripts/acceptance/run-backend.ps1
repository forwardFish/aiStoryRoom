param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast", [string]$BackendDir = "")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
if ([string]::IsNullOrWhiteSpace($BackendDir)) {
  foreach ($c in @("backend","server","api","apps\api")) {
    $d = Join-Path $ProjectRoot $c
    if (Test-Path (Join-Path $d "package.json")) { $BackendDir = $d; break }
  }
}
if ([string]::IsNullOrWhiteSpace($BackendDir)) {
  Add-Blocker $ProjectRoot "backend" "DEFERRED" "No backend detected"
  Write-LaneResult $ProjectRoot "backend" "DEFERRED" @() @() @("No backend detected") @()
  Write-Host "[DEFERRED] backend"
  exit 0
}
Push-Location $BackendDir
try {
  $scripts = Read-PackageScripts "package.json"
  $cmds = @("build","test","test:flows","test:api","test:health","test:e2e:runtime")
  if ($Mode -eq "fast") { $cmds = @("build","test","test:api","test:health") }
  $commands = @()
  $hardFail = $false
  foreach ($s in $cmds) {
    if ($scripts.ContainsKey($s)) {
      $logName = "backend-$($s -replace ':','-').log"
      $ok = Invoke-Gate $ProjectRoot "backend:$s" { npm run $s } $logName
      $commands += @{ command = "npm run $s"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/$logName" }
      if (-not $ok) { $hardFail = $true }
    }
  }
  Write-LaneResult $ProjectRoot "backend" $(if ($hardFail) { "HARD_FAIL" } else { "PASS" }) $commands @("docs/auto-execute/logs") $(if ($hardFail) { @("One or more backend gates failed") } else { @() }) @()
} finally { Pop-Location }
