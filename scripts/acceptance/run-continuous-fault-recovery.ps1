param(
  [string]$ProjectRoot = "",
  [int]$ApiPort = 3138,
  [int]$ProviderPort = 3148,
  [string]$EvidenceRoot = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
} else {
  [System.IO.Path]::GetFullPath($ProjectRoot)
}
$script:ProcessCaptures = @{}

function ConvertTo-ProcessArgument {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Argument)
  if ($Argument.Contains('"')) { throw "Process arguments containing quotes are not supported: $Argument" }
  if (-not $Argument -or $Argument -match '\s') { return '"' + $Argument + '"' }
  return $Argument
}

function Start-CapturedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$OutPath,
    [Parameter(Mandatory = $true)][string]$ErrPath
  )
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = (@($ArgumentList | ForEach-Object { ConvertTo-ProcessArgument -Argument ([string]$_) }) -join " ")
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Failed to start $FilePath" }
  $script:ProcessCaptures[$process.Id] = [ordered]@{
    stdout = $process.StandardOutput.ReadToEndAsync()
    stderr = $process.StandardError.ReadToEndAsync()
    outPath = $OutPath
    errPath = $ErrPath
  }
  return $process
}

function Complete-ProcessCapture {
  param([System.Diagnostics.Process]$Process)
  if (-not $Process -or -not $script:ProcessCaptures.ContainsKey($Process.Id)) { return }
  $capture = $script:ProcessCaptures[$Process.Id]
  [System.IO.File]::WriteAllText([string]$capture.outPath, [string]$capture.stdout.GetAwaiter().GetResult())
  [System.IO.File]::WriteAllText([string]$capture.errPath, [string]$capture.stderr.GetAwaiter().GetResult())
  $script:ProcessCaptures.Remove($Process.Id)
}

function Import-DotEnv {
  param([Parameter(Mandatory = $true)][string]$Path)
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { continue }
    $pair = $line.Split("=", 2)
    $key = $pair[0].Trim()
    $value = $pair[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

function Set-DatabaseSchema {
  param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$Schema, [int]$ConnectionLimit = 5)
  $queryIndex = $Url.IndexOf("?")
  if ($queryIndex -ge 0) {
    $prefix = $Url.Substring(0, $queryIndex)
    $query = @($Url.Substring($queryIndex + 1).Split("&") | Where-Object { $_ -and $_ -notmatch "^(schema|connection_limit|sslmode)=" })
  } else {
    $prefix = $Url
    $query = @()
  }
  $query += "sslmode=disable"
  $query += "schema=$Schema"
  $query += "connection_limit=$ConnectionLimit"
  return "${prefix}?" + ($query -join "&")
}

function Assert-PortAvailable {
  param([int]$Port)
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  if ($listeners.Port -contains $Port) { throw "Port $Port is already listening" }
}

function Wait-Api {
  param([System.Diagnostics.Process]$Process)
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) {
      Complete-ProcessCapture -Process $Process
      throw "API exited before readiness with code $($Process.ExitCode)"
    }
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ApiPort/api/health" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  throw "API did not become ready on port $ApiPort"
}

function Stop-ExactProcess {
  param([System.Diagnostics.Process]$Process)
  if (-not $Process) { return }
  if (-not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
  }
  $Process.WaitForExit()
  Complete-ProcessCapture -Process $Process
}

function Wait-ExitCode {
  param([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds, [string]$Label)
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    throw "$Label PID $($Process.Id) did not exit within ${TimeoutSeconds}s"
  }
  # Complete redirected-stream shutdown before reading ExitCode. Windows
  # PowerShell can otherwise expose a transient null after the timed wait.
  $Process.WaitForExit()
  Complete-ProcessCapture -Process $Process
  $Process.Refresh()
  $exitCode = $Process.ExitCode
  if ($null -eq $exitCode) { throw "$Label PID $($Process.Id) exited without an observable exit code" }
  Write-Output -NoEnumerate ([int]$exitCode)
}

function Wait-File {
  param([string]$Path, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds, [string]$Label)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) { return }
    if ($Process -and $Process.HasExited) { throw "$Label exited before writing $Path; code=$($Process.ExitCode)" }
    Start-Sleep -Milliseconds 200
  }
  throw "$Label did not write $Path within ${TimeoutSeconds}s"
}

function Clear-FaultEnvironment {
  foreach ($key in @(
    "FAIL_AFTER_CHECKPOINT", "FAIL_AFTER_CHECKPOINT_RUN_ID", "FAIL_AFTER_CHECKPOINT_WINDOW_ID",
    "FAIL_AFTER_CHECKPOINT_STAGE", "FAIL_ROLE_AGENT_AT", "FAIL_ROLE_AGENT_TASK_ID",
    "STORY_TASK_TEST_DELAY_MS"
  )) { [Environment]::SetEnvironmentVariable($key, $null, "Process") }
}

function Set-CaseEnvironment {
  param([string]$CaseDir, [string]$CaseId)
  $env:MANY_WORLDS_CASE_DIR = $CaseDir
  $env:MANY_WORLDS_CASE_ID = $CaseId
}

function Start-Worker {
  param([string]$Label, [hashtable]$Overrides = @{})
  Clear-FaultEnvironment
  $environmentKeys = @("ROLE_AGENT_PROVIDER", "ROLE_AGENT_MODEL", "ROLE_AGENT_TIMEOUT_MS")
  $environmentKeys += @($Overrides.Keys | ForEach-Object { [string]$_ })
  $environmentKeys = @($environmentKeys | Select-Object -Unique)
  $priorEnvironment = @{}
  foreach ($key in $environmentKeys) {
    $priorEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
  }

  $out = Join-Path $script:EvidenceRoot "$Label.out.log"
  $err = Join-Path $script:EvidenceRoot "$Label.err.log"
  try {
    $env:ROLE_AGENT_PROVIDER = "rules"
    $env:ROLE_AGENT_MODEL = "deterministic-rules-v1"
    $env:ROLE_AGENT_TIMEOUT_MS = "750"
    foreach ($entry in $Overrides.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, "Process")
    }
    $process = Start-CapturedProcess -FilePath $script:NodePath -ArgumentList @("apps/api/dist/worker.js") `
      -WorkingDirectory $ProjectRoot -OutPath $out -ErrPath $err
  } finally {
    foreach ($key in $environmentKeys) {
      [Environment]::SetEnvironmentVariable($key, $priorEnvironment[$key], "Process")
    }
    Clear-FaultEnvironment
  }
  return [ordered]@{ process = $process; out = $out; err = $err }
}

function Start-Driver {
  param([string]$Command, [string]$Label)
  $out = Join-Path $script:EvidenceRoot "$Label.out.log"
  $err = Join-Path $script:EvidenceRoot "$Label.err.log"
  $process = Start-CapturedProcess -FilePath $script:NodePath -ArgumentList @($script:DriverPath, $Command) `
    -WorkingDirectory $ProjectRoot -OutPath $out -ErrPath $err
  return [ordered]@{ process = $process; out = $out; err = $err }
}

function Invoke-Driver {
  param([string]$Command, [string]$Label)
  $out = Join-Path $script:EvidenceRoot "$Label.out.log"
  $err = Join-Path $script:EvidenceRoot "$Label.err.log"
  & $script:NodePath $script:DriverPath $Command 1> $out 2> $err
  if ($LASTEXITCODE -ne 0) {
    $tail = if (Test-Path -LiteralPath $err) { (Get-Content -LiteralPath $err -Tail 30) -join "`n" } else { "" }
    throw "Driver $Command failed with code $LASTEXITCODE`n$tail"
  }
  return [ordered]@{ out = $out; err = $err }
}

function Read-Json {
  param([string]$Path)
  return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Write-ProgressReport {
  param([string]$CurrentCase = "")
  $progress = [ordered]@{
    status = "RUNNING"
    checkpoint = "D09_WORKER_ROLE_AGENT_FAULT_RECOVERY"
    database = [ordered]@{ provider = "supabase"; schema = $script:Schema; localPostgresUsed = $false }
    currentCase = $CurrentCase
    completedCaseCount = $caseReports.Count
    completedCases = @($caseReports | ForEach-Object { $_.caseId })
    updatedAt = (Get-Date).ToString("o")
  }
  $progress | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $script:EvidenceRoot "progress.json") -Encoding utf8
}

function Start-FakeProvider {
  param([string]$Mode, [string]$Label)
  Assert-PortAvailable -Port $ProviderPort
  $out = Join-Path $script:EvidenceRoot "$Label.out.log"
  $err = Join-Path $script:EvidenceRoot "$Label.err.log"
  $requests = Join-Path $script:EvidenceRoot "$Label.requests.ndjson"
  $process = Start-CapturedProcess -FilePath $script:NodePath -ArgumentList @(
    "scripts/e2e/role-agent-fault-provider.mjs", $Mode, [string]$ProviderPort, $requests
  ) -WorkingDirectory $ProjectRoot -OutPath $out -ErrPath $err
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw "Fake provider $Mode exited with code $($process.ExitCode)" }
    if ((Test-Path -LiteralPath $requests) -and (Get-Content -Raw -LiteralPath $requests) -match 'LISTENING') {
      return [ordered]@{ process = $process; out = $out; err = $err; requests = $requests }
    }
    Start-Sleep -Milliseconds 100
  }
  throw "Fake provider $Mode did not become ready"
}

function Complete-ResolutionCase {
  param([hashtable]$Definition)
  $caseId = [string]$Definition.id
  $caseDir = Join-Path $script:EvidenceRoot "cases\$caseId"
  New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
  Set-CaseEnvironment -CaseDir $caseDir -CaseId $caseId
  $env:MANY_WORLDS_CHECKPOINT = [string]$Definition.checkpoint
  $env:MANY_WORLDS_TARGET_STAGE = [string]$Definition.stage
  $normal = Start-Worker -Label "$caseId-normal-worker"
  $arm = Start-Driver -Command "resolution-arm" -Label "$caseId-arm"
  try {
    Wait-File -Path (Join-Path $caseDir "barrier.json") -Process $arm.process -TimeoutSeconds 900 -Label "$caseId arm"
    Stop-ExactProcess -Process $normal.process
    New-Item -ItemType File -Path (Join-Path $caseDir "continue.signal") -Force | Out-Null
    $armExit = Wait-ExitCode -Process $arm.process -TimeoutSeconds 120 -Label "$caseId arm"
    if ($armExit -ne 0) { throw "$caseId arm exited with code $armExit" }
    $state = Read-Json -Path (Join-Path $caseDir "state.json")
    $fault = Start-Worker -Label "$caseId-fault-worker" -Overrides @{
      FAIL_AFTER_CHECKPOINT = [string]$Definition.checkpoint
      FAIL_AFTER_CHECKPOINT_RUN_ID = [string]$state.roomId
      FAIL_AFTER_CHECKPOINT_WINDOW_ID = [string]$state.windowId
      FAIL_AFTER_CHECKPOINT_STAGE = [string]$Definition.stage
    }
    $faultExit = Wait-ExitCode -Process $fault.process -TimeoutSeconds 180 -Label "$caseId fault worker"
    if ($faultExit -ne 86) { throw "$caseId expected fault worker exit 86, got $faultExit" }
    Invoke-Driver -Command "wait-lease" -Label "$caseId-wait-lease" | Out-Null
    $recovery = Start-Worker -Label "$caseId-recovery-worker"
    try { Invoke-Driver -Command "resolution-verify" -Label "$caseId-verify" | Out-Null }
    finally { Stop-ExactProcess -Process $recovery.process }
    $partial = Read-Json -Path (Join-Path $caseDir "partial.json")
    $verify = Read-Json -Path (Join-Path $caseDir "verify.json")
    return [ordered]@{
      caseId = $caseId; kind = "resolution"; stage = [int]$Definition.stage; checkpoint = [string]$Definition.checkpoint
      status = "PASS"; roomId = $state.roomId; windowId = $state.windowId
      normalWorkerPid = $normal.process.Id; faultWorkerPid = $fault.process.Id; faultWorkerExitCode = $faultExit
      recoveryWorkerPid = $recovery.process.Id; partial = $partial; verify = $verify
      logs = [ordered]@{ arm = $arm.out; fault = $fault.out; recovery = $recovery.out }
    }
  } finally {
    Stop-ExactProcess -Process $arm.process
    Stop-ExactProcess -Process $normal.process
  }
}

function Complete-RoleBoundaryCase {
  param([string]$Boundary)
  $caseId = "role-$($Boundary.ToLower().Replace('_','-'))"
  $caseDir = Join-Path $script:EvidenceRoot "cases\$caseId"
  New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
  Set-CaseEnvironment -CaseDir $caseDir -CaseId $caseId
  $env:MANY_WORLDS_ROLE_BOUNDARY = $Boundary
  $normal = Start-Worker -Label "$caseId-normal-worker"
  $arm = Start-Driver -Command "role-arm" -Label "$caseId-arm"
  try {
    Wait-File -Path (Join-Path $caseDir "barrier.json") -Process $arm.process -TimeoutSeconds 180 -Label "$caseId arm"
    Stop-ExactProcess -Process $normal.process
    New-Item -ItemType File -Path (Join-Path $caseDir "continue.signal") -Force | Out-Null
    $armExit = Wait-ExitCode -Process $arm.process -TimeoutSeconds 60 -Label "$caseId arm"
    if ($armExit -ne 0) { throw "$caseId arm exited with code $armExit" }
    $state = Read-Json -Path (Join-Path $caseDir "state.json")
    $fault = Start-Worker -Label "$caseId-fault-worker" -Overrides @{
      FAIL_ROLE_AGENT_AT = $Boundary
      FAIL_ROLE_AGENT_TASK_ID = [string]$state.taskId
    }
    $faultExit = Wait-ExitCode -Process $fault.process -TimeoutSeconds 90 -Label "$caseId fault worker"
    if ($faultExit -ne 86) { throw "$caseId expected fault worker exit 86, got $faultExit" }
    Invoke-Driver -Command "wait-lease" -Label "$caseId-wait-lease" | Out-Null
    $recovery = Start-Worker -Label "$caseId-recovery-worker"
    try {
      $env:MANY_WORLDS_EXPECT_FALLBACK = "false"
      $env:MANY_WORLDS_EXPECT_RECOVERY = "true"
      Invoke-Driver -Command "role-verify" -Label "$caseId-verify" | Out-Null
    } finally {
      Stop-ExactProcess -Process $recovery.process
      Remove-Item Env:MANY_WORLDS_EXPECT_FALLBACK -ErrorAction SilentlyContinue
      Remove-Item Env:MANY_WORLDS_EXPECT_RECOVERY -ErrorAction SilentlyContinue
    }
    $partial = Read-Json -Path (Join-Path $caseDir "partial.json")
    $verify = Read-Json -Path (Join-Path $caseDir "verify.json")
    return [ordered]@{
      caseId = $caseId; kind = "role-agent"; boundary = $Boundary; status = "PASS"
      roomId = $state.roomId; windowId = $state.windowId; roleId = $state.roleId; taskId = $state.taskId
      normalWorkerPid = $normal.process.Id; faultWorkerPid = $fault.process.Id; faultWorkerExitCode = $faultExit
      recoveryWorkerPid = $recovery.process.Id; partial = $partial; verify = $verify
      logs = [ordered]@{ arm = $arm.out; fault = $fault.out; recovery = $recovery.out }
    }
  } finally {
    Stop-ExactProcess -Process $arm.process
    Stop-ExactProcess -Process $normal.process
  }
}

function Complete-ProviderFallbackCase {
  param([string]$Mode)
  $caseId = "role-provider-$Mode"
  $caseDir = Join-Path $script:EvidenceRoot "cases\$caseId"
  New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
  Set-CaseEnvironment -CaseDir $caseDir -CaseId $caseId
  $env:MANY_WORLDS_ROLE_BOUNDARY = "PROVIDER_FALLBACK"
  $arm = Start-Driver -Command "role-arm" -Label "$caseId-arm"
  try {
    Wait-File -Path (Join-Path $caseDir "barrier.json") -Process $arm.process -TimeoutSeconds 180 -Label "$caseId arm"
    New-Item -ItemType File -Path (Join-Path $caseDir "continue.signal") -Force | Out-Null
    $armExit = Wait-ExitCode -Process $arm.process -TimeoutSeconds 60 -Label "$caseId arm"
    if ($armExit -ne 0) { throw "$caseId arm exited with code $armExit" }
    $state = Read-Json -Path (Join-Path $caseDir "state.json")
    $provider = Start-FakeProvider -Mode $Mode -Label "$caseId-provider"
    try {
      $worker = Start-Worker -Label "$caseId-worker" -Overrides @{
        ROLE_AGENT_PROVIDER = "deepseek"
        ROLE_AGENT_MODEL = "fault-model"
        ROLE_AGENT_TIMEOUT_MS = "750"
        DEEPSEEK_API_KEY = "fault-test-key"
        DEEPSEEK_BASE_URL = "http://127.0.0.1:$ProviderPort"
      }
      try {
        $env:MANY_WORLDS_EXPECT_FALLBACK = "true"
        $env:MANY_WORLDS_EXPECT_RECOVERY = "false"
        Invoke-Driver -Command "role-verify" -Label "$caseId-verify" | Out-Null
      } finally {
        Stop-ExactProcess -Process $worker.process
        Remove-Item Env:MANY_WORLDS_EXPECT_FALLBACK -ErrorAction SilentlyContinue
        Remove-Item Env:MANY_WORLDS_EXPECT_RECOVERY -ErrorAction SilentlyContinue
      }
      $verify = Read-Json -Path (Join-Path $caseDir "verify.json")
      $requestCount = @((Get-Content -LiteralPath $provider.requests -ErrorAction SilentlyContinue) | Where-Object { $_ -and $_ -notmatch 'LISTENING' }).Count
      if ($requestCount -lt 1) { throw "$caseId did not call the controlled provider" }
      return [ordered]@{
        caseId = $caseId; kind = "role-agent-provider"; mode = $Mode; status = "PASS"
        roomId = $state.roomId; windowId = $state.windowId; roleId = $state.roleId; taskId = $state.taskId
        workerPid = $worker.process.Id; providerPid = $provider.process.Id; providerRequestCount = $requestCount
        verify = $verify; logs = [ordered]@{ arm = $arm.out; worker = $worker.out; provider = $provider.out; requests = $provider.requests }
      }
    } finally { Stop-ExactProcess -Process $provider.process }
  } finally { Stop-ExactProcess -Process $arm.process }
}

$envPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing .env at $envPath" }
Assert-PortAvailable -Port $ApiPort
Assert-PortAvailable -Port $ProviderPort
Import-DotEnv -Path $envPath
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DATABASE_URL)) { throw "SUPABASE_DATABASE_URL is missing" }
if ($env:SUPABASE_DATABASE_URL -notmatch "supabase") { throw "Fault acceptance requires Supabase; refusing a non-Supabase URL" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
  $EvidenceRoot = Join-Path ([System.IO.Path]::GetTempPath()) "continuous-fault-recovery-$stamp"
}
$script:EvidenceRoot = [System.IO.Path]::GetFullPath($EvidenceRoot)
New-Item -ItemType Directory -Path $script:EvidenceRoot -Force | Out-Null
$schema = "cs_accept_fault_$($stamp.Replace('-','_'))"
$script:Schema = $schema
$migrationDatabaseUrl = Set-DatabaseSchema -Url $env:SUPABASE_DATABASE_URL -Schema $schema -ConnectionLimit 5
$runtimeDatabaseUrl = Set-DatabaseSchema -Url $env:SUPABASE_DATABASE_URL -Schema $schema -ConnectionLimit 3
$env:DATABASE_URL = $runtimeDatabaseUrl
$env:MANY_WORLDS_DB_SCHEMA = $schema
$env:MANY_WORLDS_API_BASE = "http://127.0.0.1:$ApiPort/api"
$env:MANY_WORLDS_SUITE_STATE = Join-Path $script:EvidenceRoot "suite-state.secret.json"
$env:MANY_WORLDS_ACTIVE_ROOM_PATH = Join-Path $script:EvidenceRoot "active-room.json"
$env:MANY_WORLDS_HEARTBEAT_STOP_PATH = Join-Path $script:EvidenceRoot "heartbeat.stop"
$env:AUTH_MAIL_SINK_FILE = Join-Path $script:EvidenceRoot "mail.secret.ndjson"
$env:NODE_ENV = "test"
$env:MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = "true"
$env:STORY_WORKER_EMBEDDED = "false"
$env:CONTINUOUS_TIMING_PROFILE = "fault-acceptance"
$env:ROLE_AGENT_PROVIDER = "rules"
$env:EMAIL_PROVIDER = "file-sink"
$env:PUBLIC_WEB_URL = "http://127.0.0.1:5218"
$env:ALLOW_TEST_CREDIT_GRANT = "true"
$env:STORY_TASK_LEASE_MS = "5000"
$env:CORS_ALLOWED_ORIGINS = "http://127.0.0.1:5218"
$env:NODE_PATH = (Join-Path $ProjectRoot "apps\api\node_modules") + ";" + (Join-Path $ProjectRoot "node_modules")
New-Item -ItemType File -Path $env:AUTH_MAIL_SINK_FILE -Force | Out-Null
Clear-FaultEnvironment

$script:NodePath = (Get-Command node).Source
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = (Get-Command pnpm).Source }
$compiledDir = Join-Path $script:EvidenceRoot "compiled"
$script:DriverPath = Join-Path $compiledDir "continuous-strategy-fault-recovery.js"
$api = $null
$heartbeat = $null
$caseReports = [System.Collections.Generic.List[object]]::new()
$startedAt = (Get-Date).ToString("o")

try {
  Push-Location $ProjectRoot
  if (-not $SkipBuild) {
    # The browser stack may still hold Prisma's Windows query-engine DLL.
    # Fault acceptance only needs fresh application output; regenerating an
    # already-current Prisma Client would fail on the locked binary and is not
    # evidence for this lane.
    & $pnpm --filter @apps/api build
    if ($LASTEXITCODE -ne 0) { throw "API build failed with exit code $LASTEXITCODE" }
  }
  try {
    $env:DATABASE_URL = $migrationDatabaseUrl
    & $pnpm exec prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "Supabase migrate deploy failed with exit code $LASTEXITCODE" }
  } finally {
    $env:DATABASE_URL = $runtimeDatabaseUrl
  }
  & $script:NodePath node_modules/typescript/bin/tsc --target ES2022 --module CommonJS --moduleResolution Node `
    --esModuleInterop --skipLibCheck --strict --typeRoots apps/api/node_modules/@types --types node `
    --outDir $compiledDir scripts/e2e/continuous-strategy-fault-recovery.ts
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $script:DriverPath)) { throw "Fault driver compilation failed" }

  $env:PORT = [string]$ApiPort
  $apiOut = Join-Path $script:EvidenceRoot "api.out.log"
  $apiErr = Join-Path $script:EvidenceRoot "api.err.log"
  $api = Start-CapturedProcess -FilePath $script:NodePath -ArgumentList @("apps/api/dist/main.js") `
    -WorkingDirectory $ProjectRoot -OutPath $apiOut -ErrPath $apiErr
  Wait-Api -Process $api
  Invoke-Driver -Command "init" -Label "suite-init" | Out-Null
  $heartbeat = Start-Driver -Command "heartbeat-loop" -Label "heartbeat-loop"

  $resolutionCases = @(
    @{ id = "r3-rules-applied"; stage = 3; checkpoint = "RULES_APPLIED" },
    @{ id = "r3-public-projected"; stage = 3; checkpoint = "PUBLIC_PROJECTED" },
    @{ id = "r3-role-projected-1"; stage = 3; checkpoint = "ROLE_PROJECTED:1" },
    @{ id = "r3-role-projected-2"; stage = 3; checkpoint = "ROLE_PROJECTED:2" },
    @{ id = "r3-role-projected-3"; stage = 3; checkpoint = "ROLE_PROJECTED:3" },
    @{ id = "r3-published"; stage = 3; checkpoint = "PUBLISHED" },
    @{ id = "r3-next-window-opened"; stage = 3; checkpoint = "NEXT_WINDOW_OPENED" },
    @{ id = "r7-published"; stage = 7; checkpoint = "PUBLISHED" },
    @{ id = "r7-run-completed"; stage = 7; checkpoint = "RUN_COMPLETED" }
  )
  foreach ($definition in $resolutionCases) {
    Write-Host "[fault] $($definition.id)"
    Write-ProgressReport -CurrentCase $definition.id
    $caseReports.Add((Complete-ResolutionCase -Definition $definition))
    Write-ProgressReport -CurrentCase ""
  }
  foreach ($boundary in @("TASK_LEASED", "PROVIDER_RETURNED", "ACTION_SEALED")) {
    Write-Host "[fault] role $boundary"
    Write-ProgressReport -CurrentCase "role-$Boundary"
    $caseReports.Add((Complete-RoleBoundaryCase -Boundary $boundary))
    Write-ProgressReport -CurrentCase ""
  }
  foreach ($mode in @("invalid-json", "timeout")) {
    Write-Host "[fault] provider $mode"
    Write-ProgressReport -CurrentCase "role-provider-$mode"
    $caseReports.Add((Complete-ProviderFallbackCase -Mode $mode))
    Write-ProgressReport -CurrentCase ""
  }

  New-Item -ItemType File -Path $env:MANY_WORLDS_HEARTBEAT_STOP_PATH -Force | Out-Null
  $heartbeatExit = Wait-ExitCode -Process $heartbeat.process -TimeoutSeconds 20 -Label "heartbeat loop"
  if ($heartbeatExit -ne 0) { throw "Heartbeat loop exited with code $heartbeatExit" }
  $report = [ordered]@{
    status = "PASS"
    checkpoint = "D09_WORKER_ROLE_AGENT_FAULT_RECOVERY"
    database = [ordered]@{ provider = "supabase"; schema = $schema; localPostgresUsed = $false }
    source = [ordered]@{
      gitHead = (& git rev-parse HEAD).Trim()
      driverSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath "scripts/e2e/continuous-strategy-fault-recovery.ts").Hash.ToLower()
      orchestratorSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath "scripts/acceptance/run-continuous-fault-recovery.ps1").Hash.ToLower()
    }
    process = [ordered]@{ apiPid = $api.Id; heartbeatPid = $heartbeat.process.Id }
    counts = [ordered]@{ resolutionCheckpointCases = 9; roleAgentCheckpointCases = 3; providerFallbackCases = 2; total = $caseReports.Count }
    cases = @($caseReports)
    startedAt = $startedAt
    completedAt = (Get-Date).ToString("o")
  }
  $reportPath = Join-Path $script:EvidenceRoot "report.json"
  $report | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $reportPath -Encoding utf8
  $report | ConvertTo-Json -Depth 6
} catch {
  $failure = [ordered]@{
    status = "FAIL"; checkpoint = "D09_WORKER_ROLE_AGENT_FAULT_RECOVERY"
    database = [ordered]@{ provider = "supabase"; schema = $schema; localPostgresUsed = $false }
    message = $_.Exception.Message; completedCases = @($caseReports); startedAt = $startedAt; failedAt = (Get-Date).ToString("o")
  }
  $failure | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $script:EvidenceRoot "report.json") -Encoding utf8
  throw
} finally {
  if (-not (Test-Path -LiteralPath $env:MANY_WORLDS_HEARTBEAT_STOP_PATH)) {
    New-Item -ItemType File -Path $env:MANY_WORLDS_HEARTBEAT_STOP_PATH -Force | Out-Null
  }
  Stop-ExactProcess -Process $heartbeat.process
  Stop-ExactProcess -Process $api
  Clear-FaultEnvironment
  Pop-Location -ErrorAction SilentlyContinue
}
