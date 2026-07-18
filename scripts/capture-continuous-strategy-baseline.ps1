param(
  [string]$ProjectRoot,
  [Parameter(Mandatory = $true)][string]$AttemptId,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $ProjectRoot) {
  $scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $ProjectRoot = (Resolve-Path (Join-Path $scriptRoot "..")).Path
}

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $ProjectRoot "docs/auto-execute/evidence/continuous-strategy/$AttemptId"
}

function Get-Sha256Text([string]$Value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "")).ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-CommandStdoutHash([string]$FileName, [string[]]$Arguments) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FileName
  $psi.WorkingDirectory = $ProjectRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = (($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' ')
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  [void]$process.Start()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash($process.StandardOutput.BaseStream) }
  finally { $sha.Dispose() }
  $process.WaitForExit()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($process.ExitCode -ne 0) { throw "$FileName failed ($($process.ExitCode)): $stderr" }
  return ([BitConverter]::ToString($hash).Replace("-", "")).ToLowerInvariant()
}

function Get-FileRecord([string]$RelativePath) {
  $absolute = Join-Path $ProjectRoot $RelativePath
  if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) {
    return [ordered]@{ path = $RelativePath.Replace("\", "/"); state = "DELETED"; bytes = 0; sha256 = $null }
  }
  $item = Get-Item -LiteralPath $absolute
  return [ordered]@{
    path = $RelativePath.Replace("\", "/")
    state = "PRESENT"
    bytes = $item.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $absolute).Hash.ToLowerInvariant()
  }
}

function Get-FileSetHash([string[]]$RelativePaths) {
  $records = @($RelativePaths | Sort-Object -Unique | ForEach-Object { Get-FileRecord $_ })
  return [ordered]@{
    hash = Get-Sha256Text (($records | ConvertTo-Json -Depth 8 -Compress))
    files = $records
  }
}

function Get-WorkspaceFilePaths([string[]]$RelativeRoots, [string[]]$Extensions = @()) {
  $projectPrefix = $ProjectRoot.TrimEnd([char[]]"\/") + [System.IO.Path]::DirectorySeparatorChar
  $paths = @()
  foreach ($relativeRoot in $RelativeRoots) {
    $absoluteRoot = Join-Path $ProjectRoot $relativeRoot
    if (Test-Path -LiteralPath $absoluteRoot -PathType Leaf) {
      $paths += $relativeRoot.Replace("\", "/")
      continue
    }
    if (-not (Test-Path -LiteralPath $absoluteRoot -PathType Container)) { continue }
    $paths += @(Get-ChildItem -LiteralPath $absoluteRoot -File -Recurse | Where-Object {
      $Extensions.Count -eq 0 -or $Extensions -contains $_.Extension.ToLowerInvariant()
    } | ForEach-Object {
      $_.FullName.Substring($projectPrefix.Length).Replace("\", "/")
    })
  }
  return @($paths | Sort-Object -Unique)
}

Push-Location $ProjectRoot
try {
  $branch = (& git branch --show-current).Trim()
  $headSha = (& git rev-parse HEAD).Trim()
  $headCommitTime = (& git show -s --format=%cI HEAD).Trim()
  $statusLines = @(& git -c core.quotepath=false status --porcelain=v1 -uall)
  if ($LASTEXITCODE -ne 0) { throw "git status failed" }
  $statusText = ($statusLines -join "`n") + "`n"
  $statusZSha256 = Get-CommandStdoutHash "git" @("-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "-uall")
  $trackedPatchSha256 = Get-CommandStdoutHash "git" @("diff", "--binary", "HEAD")

  $untracked = @(& git -c core.quotepath=false ls-files --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw "git ls-files failed" }
  $untracked = @($untracked | Where-Object {
    $normalized = $_.Replace("\", "/")
    $normalized -notmatch "(^|/)node_modules/" -and
    $normalized -notmatch "(^|/)dist(-vercel)?/" -and
    $normalized -notmatch "(^|/)\.codex-runs/" -and
    $normalized -notlike "docs/auto-execute/evidence/continuous-strategy/$AttemptId/*"
  })
  $untrackedRecords = @($untracked | Sort-Object -Unique | ForEach-Object { Get-FileRecord $_ })

  $dirtyPaths = @()
  foreach ($line in $statusLines) {
    if ($line.Length -ge 4) { $dirtyPaths += $line.Substring(3).Trim('"') }
  }
  $dirtyRecords = @($dirtyPaths | Sort-Object -Unique | ForEach-Object { Get-FileRecord $_ })

  $planSuffix = -join ([char[]]@(0x5B8C,0x6574,0x5F00,0x53D1,0x6B65,0x9AA4,0x4E0E,0x9A8C,0x6536,0x65B9,0x6848,0x002E,0x006D,0x0064))
  $testPlanSuffix = -join ([char[]]@(0x4E09,0x771F,0x5B9E,0x73A9,0x5BB6,0x4E03,0x8F6E,0x529F,0x80FD,0x6D4B,0x8BD5,0x65B9,0x6848,0x002E,0x006D,0x0064))
  $planMatches = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "docs") -File | Where-Object { $_.Name.StartsWith("Many_Worlds_") -and $_.Name.EndsWith($planSuffix) })
  $testPlanMatches = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "docs") -File | Where-Object { $_.Name.StartsWith("Many_Worlds_") -and $_.Name.EndsWith($testPlanSuffix) })
  if ($planMatches.Count -ne 1) { throw "Expected exactly one plan document, found $($planMatches.Count)" }
  if ($testPlanMatches.Count -ne 1) { throw "Expected exactly one paired test plan document, found $($testPlanMatches.Count)" }
  $plan = Get-FileRecord ("docs/" + $planMatches[0].Name)
  $testPlan = Get-FileRecord ("docs/" + $testPlanMatches[0].Name)
  $schema = Get-FileRecord "prisma/schema.prisma"
  $migrationFiles = Get-WorkspaceFilePaths @("prisma/migrations")
  $migrationSet = Get-FileSetHash $migrationFiles
  $webFiles = Get-WorkspaceFilePaths @("apps/web/src", "apps/web/public", "apps/web/tests", "vercel.json", "scripts/deploy/prepare-vercel-web-assets.mjs") @(".css", ".html", ".js", ".json", ".mjs", ".ts")
  $webSet = Get-FileSetHash $webFiles
  $apiFiles = Get-WorkspaceFilePaths @("apps/api/src", "packages/shared/src") @(".json", ".ts")
  $apiSet = Get-FileSetHash $apiFiles
  $strategyFiles = Get-WorkspaceFilePaths @("packages/templates/authoring", "packages/templates/config/game-registry.json", "packages/templates/config/sangtian", "packages/templates/src/continuous-strategy", "packages/templates/src/game-registry", "packages/templates/tests") @(".json", ".md", ".ts")
  $strategySet = Get-FileSetHash $strategyFiles
  $registry = Get-FileRecord "packages/templates/config/sangtian/strategy-registry.json"

  $fingerprintInput = [ordered]@{
    headSha = $headSha
    statusZSha256 = $statusZSha256
    trackedPatchSha256 = $trackedPatchSha256
    inScopeUntracked = $untrackedRecords
  }
  $baselineFingerprint = Get-Sha256Text (($fingerprintInput | ConvertTo-Json -Depth 20 -Compress))
  $dirtyDigest = Get-Sha256Text (([ordered]@{ status = $statusText; dirty = $dirtyRecords } | ConvertTo-Json -Depth 20 -Compress))

  $baseline = [ordered]@{
    schemaVersion = "continuous-strategy-baseline-v1"
    goalId = "continuous-strategy-v1.1"
    attemptId = $AttemptId
    capturedAt = [DateTimeOffset]::Now.ToString("o")
    timezone = [System.TimeZoneInfo]::Local.Id
    sourceBranch = $branch
    sourceHeadSha = $headSha
    sourceHeadCommitTime = $headCommitTime
    gitStatusPorcelainV1WithUntracked = $statusText
    statusZSha256 = $statusZSha256
    trackedPatchSha256 = $trackedPatchSha256
    dirtyFileList = $dirtyRecords
    inScopeUntracked = $untrackedRecords
    dirtyDigest = $dirtyDigest
    baselineSourceFingerprint = $baselineFingerprint
    planHash = $plan.sha256
    pairedTestPlanHash = $testPlan.sha256
    prismaSchemaHash = $schema.sha256
    migrationDirectoryHash = $migrationSet.hash
    migrationFiles = $migrationSet.files
    webRouteConfigHash = $webSet.hash
    webRouteFiles = $webSet.files
    apiContractHash = $apiSet.hash
    apiContractFiles = $apiSet.files
    strategyArtifactHash = $strategySet.hash
    strategyArtifactFiles = $strategySet.files
    strategyRegistryHash = $registry.sha256
    exclusions = @("node_modules", "dist", "dist-vercel", ".codex-runs", "current attempt evidence directory")
  }

  [System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
  $jsonPath = Join-Path $OutputDirectory "baseline-source.json"
  $statusPath = Join-Path $OutputDirectory "git-status-before.txt"
  $json = $baseline | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText($jsonPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($statusPath, $statusText, [System.Text.UTF8Encoding]::new($false))
  $summary = [ordered]@{
    baselinePath = (Resolve-Path $jsonPath).Path
    baselineSourceFingerprint = $baselineFingerprint
    dirtyDigest = $dirtyDigest
    dirtyEntries = $dirtyRecords.Count
    inScopeUntracked = $untrackedRecords.Count
    headSha = $headSha
  }
  $summary | ConvertTo-Json -Depth 5
}
finally {
  Pop-Location
}
