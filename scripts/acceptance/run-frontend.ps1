param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast", [string]$FrontendDir = "")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
if ([string]::IsNullOrWhiteSpace($FrontendDir)) {
  foreach ($c in @("frontend","apps\web","web","app")) {
    $d = Join-Path $ProjectRoot $c
    if ((Test-Path -LiteralPath (Join-Path $d "pubspec.yaml")) -or (Test-Path -LiteralPath (Join-Path $d "package.json"))) { $FrontendDir = $d; break }
  }
}
if ([string]::IsNullOrWhiteSpace($FrontendDir)) {
  Add-Blocker $ProjectRoot "frontend" "DEFERRED" "No frontend detected"
  Write-LaneResult $ProjectRoot "frontend" "DEFERRED" @() @() @("No frontend detected") @()
  Write-Host "[DEFERRED] frontend"
  exit 0
}
Push-Location $FrontendDir
try {
  $commands = @()
  $hardFail = $false
  if (Test-Path "pubspec.yaml") {
    if (!(Test-Path ".dart_tool")) {
      $ok = Invoke-Gate $ProjectRoot "frontend:flutter-pub-get" { flutter pub get } "frontend-flutter-pub-get.log"
      $commands += @{ command = "flutter pub get"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/frontend-flutter-pub-get.log" }
      if (-not $ok) { $hardFail = $true }
    }
    foreach ($pair in @(
      @{ gate="frontend:flutter-analyze"; command="flutter analyze"; log="frontend-flutter-analyze.log"; script={ flutter analyze } },
      @{ gate="frontend:flutter-test"; command="flutter test"; log="frontend-flutter-test.log"; script={ flutter test } },
      @{ gate="frontend:flutter-build-web"; command="flutter build web"; log="frontend-flutter-build-web.log"; script={ flutter build web } }
    )) {
      $ok = Invoke-Gate $ProjectRoot $pair.gate $pair.script $pair.log
      $commands += @{ command = $pair.command; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/$($pair.log)" }
      if (-not $ok) { $hardFail = $true }
    }
    if ($Mode -eq "full") {
      $ok = Invoke-Gate $ProjectRoot "frontend:flutter-build-apk-debug" { flutter build apk --debug } "frontend-flutter-build-apk-debug.log"
      $commands += @{ command = "flutter build apk --debug"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/frontend-flutter-build-apk-debug.log" }
      if (-not $ok) { $hardFail = $true }
    }
  } elseif (Test-Path "package.json") {
    $scripts = Read-PackageScripts "package.json"
    $cmds = @("lint","typecheck","test","build")
    if ($Mode -eq "fast") { $cmds = @("test","build") }
    foreach ($s in $cmds) {
      if ($scripts.ContainsKey($s)) {
        $logName = "frontend-$s.log"
        $ok = Invoke-Gate $ProjectRoot "frontend:$s" { npm run $s } $logName
        $commands += @{ command = "npm run $s"; status = $(if ($ok) { "PASS" } else { "HARD_FAIL" }); log = "docs/auto-execute/logs/$logName" }
        if (-not $ok) { $hardFail = $true }
      }
    }
  }
  Write-LaneResult $ProjectRoot "frontend" $(if ($hardFail) { "HARD_FAIL" } else { "PASS" }) $commands @("docs/auto-execute/logs") $(if ($hardFail) { @("One or more frontend gates failed") } else { @() }) @()
} finally { Pop-Location }
