param(
  [string]$ProjectRoot = (Get-Location).Path,
  [string]$Mode = "fast",
  [string[]]$Packages = @()
)
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

if ($Packages.Count -eq 0) {
  $Packages = Get-HarnessListValue $ProjectRoot "verifierDependencies" "packages"
}
if ($Packages.Count -eq 0) {
  $Packages = @("playwright","pixelmatch","pngjs")
}
$allowInstall = Get-HarnessBoolValue $ProjectRoot "verifierDependencies" "allowInstallDevDependencies" $false
$allowEphemeralNpx = Get-HarnessBoolValue $ProjectRoot "verifierDependencies" "allowEphemeralNpx" $true
$installBrowsers = Get-HarnessBoolValue $ProjectRoot "verifierDependencies" "installPlaywrightBrowsers" $false
$packageJson = Join-Path $ProjectRoot "package.json"
$out = Join-Path $p.Results "verifier-dependencies.json"
$log = Join-Path $p.Logs "verifier-dependencies.log"
$commands = @()
$missing = @()
$installed = @()
$blockers = @()
$warnings = @()
$packageDiagnostics = @()

function Get-ToolVersion($Name, $VersionArgs = @("--version")) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) {
    return [PSCustomObject]@{ available=$false; path=""; version="" }
  }
  $version = ""
  try {
    $version = (& $Name @VersionArgs 2>$null | Select-Object -First 1)
  } catch {}
  return [PSCustomObject]@{ available=$true; path=$cmd.Source; version=[string]$version }
}

function Test-NodePackageAvailable([string]$PackageName) {
  if (!(Test-CommandExists "node")) { return $false }
  & node -e "require.resolve(process.argv[1])" $PackageName *> $null
  return ($LASTEXITCODE -eq 0)
}

function Test-PlaywrightBrowserAvailable {
  if (!(Test-NodePackageAvailable "playwright")) { return $false }
  $probe = @"
const { chromium } = require('playwright');
const fs = require('fs');
try {
  const exe = chromium.executablePath();
  process.exit(fs.existsSync(exe) ? 0 : 1);
} catch {
  process.exit(1);
}
"@
  & node -e $probe *> $null
  return ($LASTEXITCODE -eq 0)
}

$toolchainDiagnostics = [ordered]@{
  node = Get-ToolVersion "node"
  npm = Get-ToolVersion "npm"
  npx = Get-ToolVersion "npx"
  pnpm = Get-ToolVersion "pnpm"
  yarn = Get-ToolVersion "yarn"
  packageJson = (Test-Path -LiteralPath $packageJson)
  policy = @{
    allowInstallDevDependencies = $allowInstall
    allowEphemeralNpx = $allowEphemeralNpx
    installPlaywrightBrowsers = $installBrowsers
  }
}

if (!(Test-CommandExists "node")) {
  $blockers += "Node is not available; UI verifier Node scripts cannot run."
  Write-LaneResult $ProjectRoot "verifier-dependencies" "DOCUMENTED_BLOCKER" @() @((Get-RelativeEvidencePath $ProjectRoot $out)) $blockers @("Install Node or configure custom verifier commands.")
  @{ schemaVersion=$AE_SCHEMA_VERSION; lane="verifier-dependencies"; status="DOCUMENTED_BLOCKER"; policy=$toolchainDiagnostics.policy; tools=@{ node=$false; npx=(Test-CommandExists "npx"); playwrightPackageAvailable=$false; pixelmatchPackageAvailable=$false; pngjsPackageAvailable=$false; playwrightBrowsersAvailable=$false }; classification=@{ uiCapturePossible="BLOCKED"; pixelDiffPossible=$false; canUseEphemeralNpx=$false }; warnings=@(); packages=$Packages; missing=$Packages; blockers=$blockers; toolchainDiagnostics=$toolchainDiagnostics; resolutionSummary="Node is unavailable, so verifier dependency resolution cannot proceed."; blockerCategory="environment"; updatedAt=(Get-Date).ToString("s") } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $out
  exit 4
}

Push-Location $ProjectRoot
try {
  foreach ($pkg in $Packages) {
    & node -e "require.resolve(process.argv[1])" $pkg *> $null
    $resolved = ($LASTEXITCODE -eq 0)
    $packageDiagnostics += [PSCustomObject]@{
      package = $pkg
      localResolvable = $resolved
      resolutionMode = $(if ($resolved) { "project-local" } elseif ($allowEphemeralNpx -and (Test-CommandExists "npx")) { "ephemeral-npx-allowed" } elseif ($allowInstall) { "install-allowed" } else { "unavailable-no-mutation" })
    }
    if (-not $resolved) { $missing += $pkg }
  }

  if ($missing.Count -gt 0) {
    if ($allowEphemeralNpx -and (Test-CommandExists "npx")) {
      $warnings += "Verifier packages are missing locally, but ephemeral npx/npm exec is allowed for verifier execution: $($missing -join ', ')"
      $commands += @{ command="npx/npm exec available for ephemeral verifier packages"; status="PASS_WITH_LIMITATION"; log="" }
    } elseif (!(Test-Path -LiteralPath $packageJson)) {
      $blockers += "Missing verifier packages but package.json was not found: $($missing -join ', ')"
    } elseif (-not $allowInstall) {
      $blockers += "Missing verifier packages and verifierDependencies.allowInstallDevDependencies is false: $($missing -join ', ')"
    } else {
      $pm = ""
      $args = @()
      if ((Test-Path -LiteralPath (Join-Path $ProjectRoot "pnpm-lock.yaml")) -and (Test-CommandExists "pnpm")) {
        $pm = "pnpm"; $args = @("add","-D") + $missing
      } elseif ((Test-Path -LiteralPath (Join-Path $ProjectRoot "yarn.lock")) -and (Test-CommandExists "yarn")) {
        $pm = "yarn"; $args = @("add","-D") + $missing
      } elseif (Test-CommandExists "npm") {
        $pm = "npm"; $args = @("install","-D") + $missing
      } else {
        $blockers += "No supported package manager found to install verifier dev dependencies."
      }
      if ($pm) {
        "Installing verifier dev dependencies: $pm $($args -join ' ')" | Tee-Object -FilePath $log
        & $pm @args *>&1 | Tee-Object -FilePath $log -Append
        $code = $LASTEXITCODE
        $commands += @{ command="$pm $($args -join ' ')"; status=$(if ($code -eq 0) { "PASS" } else { "HARD_FAIL" }); log=Get-RelativeEvidencePath $ProjectRoot $log }
        if ($code -eq 0) {
          $installed += $missing
          $missing = @()
          Add-VerificationResult $ProjectRoot "verifier-dependencies" "PASS" "Installed dev-only verifier packages: $($installed -join ', ')" $log
        } else {
          $blockers += "Verifier dependency install failed with exit code $code."
        }
      }
    }
  }

  if ($installBrowsers -and ($Packages -contains "playwright") -and (Test-CommandExists "npx")) {
    & node -e "require.resolve('playwright')" *> $null
    if ($LASTEXITCODE -eq 0) {
      & npx playwright install chromium *>&1 | Tee-Object -FilePath $log -Append
      $code = $LASTEXITCODE
      $commands += @{ command="npx playwright install chromium"; status=$(if ($code -eq 0) { "PASS" } else { "DOCUMENTED_BLOCKER" }); log=Get-RelativeEvidencePath $ProjectRoot $log }
      if ($code -ne 0) { $blockers += "Playwright package is available, but browser installation failed with exit code $code." }
    }
  }

  $stillMissing = @()
  foreach ($pkg in $Packages) {
    & node -e "require.resolve(process.argv[1])" $pkg *> $null
    if ($LASTEXITCODE -ne 0) { $stillMissing += $pkg }
  }
  $status = if ($stillMissing.Count -eq 0) { "PASS" } elseif ($allowEphemeralNpx -and (Test-CommandExists "npx")) { "PASS_WITH_LIMITATION" } elseif ($allowInstall) { "DOCUMENTED_BLOCKER" } else { "DOCUMENTED_BLOCKER" }
  if ($stillMissing.Count -gt 0) {
    if ($allowEphemeralNpx -and (Test-CommandExists "npx")) {
      $warnings += "Verifier packages still unavailable locally: $($stillMissing -join ', '). Dependent lanes may use ephemeral npx but cannot claim local dependency PASS."
    } else {
      $blockers += "Verifier packages still unavailable: $($stillMissing -join ', ')"
    }
  }
  $resolutionSummary = if ($stillMissing.Count -eq 0) {
    "All verifier packages are locally resolvable."
  } elseif ($allowEphemeralNpx -and (Test-CommandExists "npx")) {
    "Verifier packages are not locally resolvable, but ephemeral npx/npm exec is allowed; dependent lanes must still prove execution evidence."
  } elseif ($allowInstall) {
    "Verifier packages are missing and install was allowed, but resolution did not fully succeed."
  } else {
    "Verifier packages are missing and dependency mutation is disabled; this is an environment/tooling blocker, not a product code pass."
  }
  $playwrightPackageAvailable = Test-NodePackageAvailable "playwright"
  $pixelmatchPackageAvailable = Test-NodePackageAvailable "pixelmatch"
  $pngjsPackageAvailable = Test-NodePackageAvailable "pngjs"
  $playwrightBrowsersAvailable = Test-PlaywrightBrowserAvailable
  if (-not $playwrightPackageAvailable -and $allowEphemeralNpx) { $warnings += "Playwright is not installed locally; ephemeral npx is allowed." }
  if (-not ($pixelmatchPackageAvailable -and $pngjsPackageAvailable)) { $warnings += "Pixel diff is unavailable; UI pixel-perfect PASS is not allowed without visual diff evidence." }
  if ($playwrightPackageAvailable -and -not $playwrightBrowsersAvailable) { $warnings += "Playwright package is available but Chromium browser runtime was not found." }
  $tools = [ordered]@{
    node = (Test-CommandExists "node")
    npx = (Test-CommandExists "npx")
    playwrightPackageAvailable = $playwrightPackageAvailable
    pixelmatchPackageAvailable = $pixelmatchPackageAvailable
    pngjsPackageAvailable = $pngjsPackageAvailable
    playwrightBrowsersAvailable = $playwrightBrowsersAvailable
  }
  $classification = [ordered]@{
    uiCapturePossible = $(if ($playwrightPackageAvailable -and $playwrightBrowsersAvailable) { "YES" } elseif ($allowEphemeralNpx -and (Test-CommandExists "npx")) { "LIMITED" } else { "BLOCKED" })
    pixelDiffPossible = ($pixelmatchPackageAvailable -and $pngjsPackageAvailable)
    canUseEphemeralNpx = ($allowEphemeralNpx -and (Test-CommandExists "npx"))
  }
  @{
    schemaVersion = $AE_SCHEMA_VERSION
    lane = "verifier-dependencies"
    status = $status
    policy = @{
      allowInstallDevDependencies = $allowInstall
      allowEphemeralNpx = $allowEphemeralNpx
      installPlaywrightBrowsers = $installBrowsers
    }
    tools = $tools
    classification = $classification
    warnings = $warnings
    allowInstallDevDependencies = $allowInstall
    allowEphemeralNpx = $allowEphemeralNpx
    installPlaywrightBrowsers = $installBrowsers
    packageJson = (Test-Path -LiteralPath $packageJson)
    packages = $Packages
    packageDiagnostics = $packageDiagnostics
    toolchainDiagnostics = $toolchainDiagnostics
    resolutionSummary = $resolutionSummary
    blockerCategory = $(if ($status -eq "PASS") { "none" } elseif ($status -eq "PASS_WITH_LIMITATION") { "tooling-limitation" } else { "environment" })
    installed = $installed
    missing = $stillMissing
    dependencyMutation = @{
      packageJsonChangedByHarness = ($installed.Count -gt 0)
      lockfileChangedByHarness = ($installed.Count -gt 0)
      defaultPolicy = "Do not modify package.json or lockfiles unless allowInstallDevDependencies=true."
    }
    commands = $commands
    blockers = $blockers
    updatedAt = (Get-Date).ToString("s")
  } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $out
  Write-LaneResult $ProjectRoot "verifier-dependencies" $status $commands @((Get-RelativeEvidencePath $ProjectRoot $out),(Get-RelativeEvidencePath $ProjectRoot $log)) $blockers @("Install missing dev-only verifier dependencies or configure custom verifier commands.")
  try {
    $lane = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
    $lane | Add-Member -NotePropertyName packages -NotePropertyValue $Packages -Force
    $lane | Add-Member -NotePropertyName installed -NotePropertyValue $installed -Force
    $lane | Add-Member -NotePropertyName missing -NotePropertyValue $stillMissing -Force
    $lane | Add-Member -NotePropertyName packageDiagnostics -NotePropertyValue $packageDiagnostics -Force
    $lane | Add-Member -NotePropertyName toolchainDiagnostics -NotePropertyValue $toolchainDiagnostics -Force
    $lane | Add-Member -NotePropertyName resolutionSummary -NotePropertyValue $resolutionSummary -Force
    $lane | Add-Member -NotePropertyName blockerCategory -NotePropertyValue $(if ($status -eq "PASS") { "none" } elseif ($status -eq "PASS_WITH_LIMITATION") { "tooling-limitation" } else { "environment" }) -Force
    $lane | Add-Member -NotePropertyName policy -NotePropertyValue @{ allowInstallDevDependencies=$allowInstall; allowEphemeralNpx=$allowEphemeralNpx; installPlaywrightBrowsers=$installBrowsers } -Force
    $lane | Add-Member -NotePropertyName tools -NotePropertyValue $tools -Force
    $lane | Add-Member -NotePropertyName classification -NotePropertyValue $classification -Force
    $lane | Add-Member -NotePropertyName warnings -NotePropertyValue $warnings -Force
    $lane | Add-Member -NotePropertyName dependencyMutation -NotePropertyValue @{
      packageJsonChangedByHarness = ($installed.Count -gt 0)
      lockfileChangedByHarness = ($installed.Count -gt 0)
      defaultPolicy = "Do not modify package.json or lockfiles unless allowInstallDevDependencies=true."
    } -Force
    $lane | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 $out
  } catch {}
  Add-VerificationResult $ProjectRoot "verifier-dependencies" $status "Verifier dependency status: $status" $out
  Write-Host "[$status] verifier-dependencies"
  exit (Get-AEExitCode $status)
} finally {
  Pop-Location
}
