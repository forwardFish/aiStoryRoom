param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$adapters = @()
if ((Test-Path -LiteralPath (Join-Path $ProjectRoot "next.config.js")) -or (Test-Path -LiteralPath (Join-Path $ProjectRoot "next.config.ts"))) { $adapters += "next" }
if ((Test-Path -LiteralPath (Join-Path $ProjectRoot "vite.config.js")) -or (Test-Path -LiteralPath (Join-Path $ProjectRoot "vite.config.ts"))) { $adapters += "react-vite" }
if ((Test-Path -LiteralPath (Join-Path $ProjectRoot "pubspec.yaml")) -or (Test-Path -LiteralPath (Join-Path $ProjectRoot "frontend\pubspec.yaml"))) { $adapters += "flutter" }
if ((Test-Path -LiteralPath (Join-Path $ProjectRoot "prisma\schema.prisma")) -or (Test-Path -LiteralPath (Join-Path $ProjectRoot "backend\prisma\schema.prisma"))) { $adapters += "nest-prisma" }
if ((Test-Path -LiteralPath (Join-Path $ProjectRoot "pyproject.toml")) -or (Test-Path -LiteralPath (Join-Path $ProjectRoot "requirements.txt"))) { $adapters += "python" }
if ((Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json")) -or (Test-Path -LiteralPath (Join-Path $ProjectRoot "backend\package.json"))) { $adapters += "node-api" }
if ($adapters.Count -eq 0) { $adapters += "generic" }

$out = Join-Path $p.Results "adapter-detect.json"
@{ adapters=$adapters; generatedAt=(Get-Date).ToString("s") } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $out
Add-VerificationResult $ProjectRoot "adapter-detect" "PASS" "Detected adapters: $($adapters -join ', ')" $out
Write-LaneResult $ProjectRoot "adapter-detect" "PASS" @() @((Get-RelativeEvidencePath $ProjectRoot $out)) @() @("Use detected adapters to choose framework-specific verification commands.")
Write-Host "[PASS] adapter-detect: $($adapters -join ', ')"
