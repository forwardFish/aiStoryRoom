param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot

if (-not (Get-HarnessLaneEnabled $ProjectRoot "secretGuard" $true)) {
  Write-LaneResult $ProjectRoot "secret-guard" "DEFERRED" @() @() @("secretGuard lane disabled in harness.yml") @()
  Write-Host "[DEFERRED] secret-guard"
  exit 0
}

$p = Get-AEPaths $ProjectRoot
$out = Join-Path $p.Summaries "secret-guard.md"
$patterns = @(
  "\.env($|\.)",
  "client_secret.*\.json$",
  "service-account.*\.json$",
  ".*secret.*\.json$",
  ".*private.*key.*",
  ".*payment.*key.*",
  ".*supabase.*key.*"
)
$contentPatterns = @("sk_live_[A-Za-z0-9_\\-]{12,}", "pk_live_[A-Za-z0-9_\\-]{12,}", "SUPABASE_SERVICE_ROLE\s*=\s*[A-Za-z0-9_\\-\\.]{12,}", "DATABASE_URL=.*(prod|production|supabase\.co)")
$suspects = @()
$staged = @()
$untracked = @()
$contentLeaks = @()
$safeExampleFiles = @()

"# Secret Guard`n`nGenerated: $(Get-Date)`n" | Set-Content -Encoding UTF8 $out

$files = Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\.git\\|\\node_modules\\|\\build\\|\\dist\\|\\.dart_tool\\|\\coverage\\|\\scripts\\acceptance\\|\\docs\\auto-execute\\" -and $_.FullName -ne $p.FinalReport }
foreach ($file in $files) {
  $rel = Get-RelativeEvidencePath $ProjectRoot $file.FullName
  $isSafeEnvExample = $false
  if ($file.Name -eq ".env.example") {
    try { $envExampleText = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop } catch { $envExampleText = "" }
    $hasLiveSecret = $false
    foreach ($pat in $contentPatterns) {
      if ($envExampleText -match $pat) { $hasLiveSecret = $true; break }
    }
    if (-not $hasLiveSecret -and $envExampleText -match "localhost|mock|local_dev|change_me|development") {
      $isSafeEnvExample = $true
      $safeExampleFiles += $rel
    }
  }
  foreach ($pat in $patterns) {
    if ($file.Name -match $pat -or $rel -match $pat) {
      if (-not $isSafeEnvExample) { $suspects += $rel }
      break
    }
  }
  if ($file.Length -lt 1048576 -and $file.Extension -match "\.(md|json|yml|yaml|txt|log|env|ps1|js|ts|dart|py)$") {
    try { $txt = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop } catch { $txt = "" }
    foreach ($pat in $contentPatterns) {
      if ($txt -match $pat) {
        $contentLeaks += "$rel matches $pat"
        break
      }
    }
  }
}

Push-Location $ProjectRoot
try {
  $gitStaged = git diff --cached --name-only 2>$null
  foreach ($s in $gitStaged) {
    if ($s -match "^docs/auto-execute/|^scripts/acceptance/") { continue }
    foreach ($pat in $patterns) {
      if ($s -match $pat) { $staged += $s; break }
    }
  }
  $gitUntracked = git ls-files --others --exclude-standard 2>$null
  foreach ($s in $gitUntracked) {
    if ($s -match "^docs/auto-execute/|^scripts/acceptance/") { continue }
    foreach ($pat in $patterns) {
      if ($s -match $pat) { $untracked += $s; break }
    }
  }
} finally { Pop-Location }

if ($suspects.Count -gt 0) {
  Add-Content -Encoding UTF8 $out "`n## Suspect files`n"
  $suspects | Sort-Object -Unique | ForEach-Object { Add-Content -Encoding UTF8 $out "- $_" }
}
if ($safeExampleFiles.Count -gt 0) {
  Add-Content -Encoding UTF8 $out "`n## Safe example files`n"
  $safeExampleFiles | Sort-Object -Unique | ForEach-Object { Add-Content -Encoding UTF8 $out "- $_ (placeholder/local example values only)" }
}
if ($staged.Count -gt 0) {
  Add-Content -Encoding UTF8 $out "`n## Staged suspect files`n"
  $staged | Sort-Object -Unique | ForEach-Object { Add-Content -Encoding UTF8 $out "- $_" }
}
if ($untracked.Count -gt 0) {
  Add-Content -Encoding UTF8 $out "`n## Untracked suspect files`n"
  $untracked | Sort-Object -Unique | ForEach-Object { Add-Content -Encoding UTF8 $out "- $_" }
}
if ($contentLeaks.Count -gt 0) {
  Add-Content -Encoding UTF8 $out "`n## Content leak patterns`n"
  $contentLeaks | Sort-Object -Unique | ForEach-Object { Add-Content -Encoding UTF8 $out "- $_" }
}

$commands = @(@{ command = "git diff --cached --name-only"; status = "PASS"; log = Get-RelativeEvidencePath $ProjectRoot $out })
$evidence = @((Get-RelativeEvidencePath $ProjectRoot $out))
if ($staged.Count -gt 0 -or $contentLeaks.Count -gt 0) {
  Add-VerificationResult $ProjectRoot "secret-guard" "HARD_FAIL" "Staged secret-like files or secret-like content patterns found" $out
  Write-LaneResult $ProjectRoot "secret-guard" "HARD_FAIL" $commands $evidence (@($staged + $contentLeaks)) @("Remove secrets from staging/logs/reports before continuing.")
  $classification = if ($staged.Count -gt 0) { "STAGED_SECRET_LIKE_FILE" } else { "SECRET_LIKE_CONTENT" }
  $hardFail = $true
  Write-Host "ERROR: secret-guard failed"
} elseif ($suspects.Count -gt 0) {
  Add-Blocker $ProjectRoot "secret-guard" "DOCUMENTED_BLOCKER" "Secret-like files found; confirm they are safe test fixtures or remove them."
  Write-LaneResult $ProjectRoot "secret-guard" "DOCUMENTED_BLOCKER" $commands $evidence $suspects @("Review suspect files before commit or publish.")
  $classification = if ($untracked.Count -gt 0) { "UNTRACKED_SECRET_LIKE_FILE" } else { "WORKTREE_SECRET_LIKE_FILE" }
  $hardFail = $false
  Write-Host "[DOCUMENTED_BLOCKER] secret-guard"
} else {
  Add-VerificationResult $ProjectRoot "secret-guard" "PASS" "No obvious secret file or content patterns found" $out
  Write-LaneResult $ProjectRoot "secret-guard" "PASS" $commands $evidence @() @()
  $classification = "CLEAN"
  $hardFail = $false
  Write-Host "[PASS] secret-guard"
}

$resultPath = Join-Path $p.Results "secret-guard.json"
try { $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json } catch { $result = [PSCustomObject]@{} }
$result | Add-Member -NotePropertyName classification -NotePropertyValue $classification -Force
$result | Add-Member -NotePropertyName hardFail -NotePropertyValue $hardFail -Force
$result | Add-Member -NotePropertyName stagedSecretLikeFiles -NotePropertyValue @($staged | Sort-Object -Unique) -Force
$result | Add-Member -NotePropertyName untrackedSecretLikeFiles -NotePropertyValue @($untracked | Sort-Object -Unique) -Force
$result | Add-Member -NotePropertyName schemaVersion -NotePropertyValue $AE_SCHEMA_VERSION -Force
$result | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $resultPath
