param(
  [string]$ProjectRoot = "D:\lyh\agent\agent-frame\aiStoryRoom",
  [string]$SchemaFile = "D:\tmp\aiStoryRoom-active-acceptance-schema.txt",
  [string]$StateFile = "D:\tmp\many-worlds-active-services.json",
  [string]$MailSinkFile = "D:\tmp\final-browser-mail.ndjson",
  [int]$ApiPort = 3118,
  [int]$WebPort = 5218,
  [ValidateSet("manual-three-page", "automated-success", "timeout", "realtime")]
  [string]$TimingProfile = "manual-three-page"
)

$ErrorActionPreference = "Stop"

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
  param([string]$Url, [string]$Schema)
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
  # Three isolated browser origins poll presence, events and room projections in
  # parallel. A single API connection causes visible INTERNAL_ERROR timeouts;
  # the standalone worker still clamps its own pool to one connection.
  $query += "connection_limit=5"
  return "${prefix}?" + ($query -join "&")
}

function Assert-PortAvailable {
  param([int]$Port)
  # Get-NetTCPConnection can block for minutes on Windows while the in-app
  # browser has pending localhost SYNs.  The acceptance preflight only needs
  # to know whether another process owns a listening socket, so query the
  # operating system's listener table directly and ignore unrelated connects.
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  if ($listeners.Port -contains $Port) {
    throw "Port $Port is already listening"
  }
}

$envPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing .env at $envPath" }
if (-not (Test-Path -LiteralPath $SchemaFile)) { throw "Missing Supabase schema marker at $SchemaFile" }
Assert-PortAvailable -Port $ApiPort
Assert-PortAvailable -Port $WebPort
Import-DotEnv -Path $envPath

$schema = (Get-Content -Raw -LiteralPath $SchemaFile).Trim()
if (-not $schema.StartsWith("cs_accept_")) { throw "Refusing non-acceptance schema: $schema" }
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DATABASE_URL)) { throw "SUPABASE_DATABASE_URL is missing" }
if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) { throw "DEEPSEEK_API_KEY is missing" }

$env:DATABASE_URL = Set-DatabaseSchema -Url $env:SUPABASE_DATABASE_URL -Schema $schema
$env:MANY_WORLDS_DB_SCHEMA = $schema
$env:NODE_ENV = "test"
$env:MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = "true"
$env:STORY_WORKER_EMBEDDED = "false"
$env:CONTINUOUS_TIMING_PROFILE = $TimingProfile
$env:ROLE_AGENT_PROVIDER = "deepseek"
$env:ROLE_AGENT_MODEL = "deepseek-chat"
$env:ROLE_AGENT_TIMEOUT_MS = "4500"
$env:EMAIL_PROVIDER = "file-sink"
$env:AUTH_MAIL_SINK_FILE = $MailSinkFile
$env:PUBLIC_WEB_URL = "http://one.localhost:$WebPort"
$env:ALLOW_TEST_CREDIT_GRANT = "true"
$env:STORY_TASK_LEASE_MS = "60000"
$env:CORS_ALLOWED_ORIGINS = "http://one.localhost:$WebPort,http://two.localhost:$WebPort,http://three.localhost:$WebPort,http://127.0.0.1:$WebPort,http://localhost:$WebPort"
$env:NODE_PATH = (Join-Path $ProjectRoot "apps\api\node_modules") + ";" + (Join-Path $ProjectRoot "node_modules")

if (Test-Path -LiteralPath $MailSinkFile) { Clear-Content -LiteralPath $MailSinkFile } else { New-Item -ItemType File -Path $MailSinkFile -Force | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$node = (Get-Command node).Source
$apiOut = "D:\tmp\many-worlds-api-$stamp.out.log"
$apiErr = "D:\tmp\many-worlds-api-$stamp.err.log"
$workerOut = "D:\tmp\many-worlds-worker-$stamp.out.log"
$workerErr = "D:\tmp\many-worlds-worker-$stamp.err.log"
$webOut = "D:\tmp\many-worlds-web-$stamp.out.log"
$webErr = "D:\tmp\many-worlds-web-$stamp.err.log"

$env:PORT = [string]$ApiPort
$api = Start-Process -FilePath $node -ArgumentList @("apps/api/dist/main.js") -WorkingDirectory $ProjectRoot -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -WindowStyle Hidden -PassThru
$worker = Start-Process -FilePath $node -ArgumentList @("apps/api/dist/worker.js") -WorkingDirectory $ProjectRoot -RedirectStandardOutput $workerOut -RedirectStandardError $workerErr -WindowStyle Hidden -PassThru
$env:PORT = [string]$WebPort
$env:API_PORT = [string]$ApiPort
$web = Start-Process -FilePath $node -ArgumentList @("apps/web/src/server.mjs") -WorkingDirectory $ProjectRoot -RedirectStandardOutput $webOut -RedirectStandardError $webErr -WindowStyle Hidden -PassThru

$state = [ordered]@{
  startedAt = (Get-Date).ToString("o")
  schema = $schema
  provider = "supabase"
  timingProfile = $TimingProfile
  api = [ordered]@{ pid = $api.Id; out = $apiOut; err = $apiErr }
  worker = [ordered]@{ pid = $worker.Id; out = $workerOut; err = $workerErr }
  web = [ordered]@{ pid = $web.Id; out = $webOut; err = $webErr }
}
$state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StateFile -Encoding utf8
$state | ConvertTo-Json -Depth 4
