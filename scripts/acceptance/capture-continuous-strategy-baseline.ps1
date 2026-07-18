param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
  [Parameter(Mandatory = $true)][string]$AttemptId,
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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

  $plan = Get-FileRecord "docs/Many_Worlds_多人连续权谋制_v1.1_完整开发步骤与验收方案.md"
  $testPlan = Get-FileRecord "docs/Many_Worlds_多人连续权谋制_v1.1_三真实玩家七轮功能测试方案.md"
  $schema = Get-FileRecord "prisma/schema.prisma"
  $migrationFiles = @(& git -c core.quotepath=false ls-files "prisma/migrations/**")
  $migrationSet = Get-FileSetHash $migrationFiles
  $webSet = Get-FileSetHash @("apps/web/src/server.mjs", "vercel.json", "scripts/deploy/prepare-vercel-web-assets.mjs", "apps/web/public/game-bootstrap.js", "apps/web/public/room-story-storage.js")
  $apiSet = Get-FileSetHash @("apps/api/src/rooms.controller.ts", "apps/api/src/rooms.service.ts", "apps/api/src/story.controller.ts", "packages/shared/src/index.ts")
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
