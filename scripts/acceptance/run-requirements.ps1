param([string]$ProjectRoot = (Get-Location).Path, [string]$Mode = "fast")
. "$PSScriptRoot\lib.ps1"
$ProjectRoot = Get-ProjectRoot $ProjectRoot
Initialize-Layout $ProjectRoot
Initialize-MachineFiles $ProjectRoot
$p = Get-AEPaths $ProjectRoot

$docFiles = @()
$harnessRequirementDocs = Get-HarnessListValue $ProjectRoot "docs" "requirements"
foreach ($item in $harnessRequirementDocs) {
  $candidate = Resolve-ProjectEvidencePath $ProjectRoot $item
  if (Test-Path -LiteralPath $candidate) {
    $resolved = Get-Item -LiteralPath $candidate
    if ($resolved.PSIsContainer) {
      $docFiles += Get-ChildItem -LiteralPath $resolved.FullName -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @(".md",".txt") -and $_.FullName -notmatch "\\docs\\auto-execute\\" }
    } else {
      $docFiles += $resolved
    }
  }
}
$docsDir = Join-Path $ProjectRoot "docs"
if (Test-Path -LiteralPath $docsDir) {
  $docFiles += Get-ChildItem -LiteralPath $docsDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".md",".txt") -and $_.FullName -notmatch "\\docs\\auto-execute\\" }
}
if ($docFiles.Count -eq 0) {
  foreach ($name in @("README.md","PRD.md","requirements.md")) {
    $candidate = Join-Path $ProjectRoot $name
    if (Test-Path -LiteralPath $candidate) { $docFiles += Get-Item -LiteralPath $candidate }
  }
}

$requirements = @()
$idx = 1
foreach ($file in ($docFiles | Sort-Object FullName -Unique | Select-Object -First 20)) {
  try { $lines = Get-Content -LiteralPath $file.FullName -ErrorAction Stop } catch { continue }
  foreach ($line in $lines) {
    $t = $line.Trim()
    if ($t.Length -lt 12) { continue }
    if ($t -match "(?i)(must|should|required|requirement|acceptance|用户|必须|需要|验收|功能)") {
      $safeDescription = $t -replace '```', '[code-fence]'
      $requirements += @{
        id = "REQ-$('{0:D3}' -f $idx)"
        source = Get-RelativeEvidencePath $ProjectRoot $file.FullName
        description = $safeDescription
        priority = $(if ($t -match "(?i)(must|required|必须|P0)") { "P0" } else { "P1" })
        surface = ""
        acceptance = @()
        normalized = $false
        status = "CANDIDATE"
        evidence = @()
      }
      $idx++
      if ($idx -gt 80) { break }
    }
  }
  if ($idx -gt 80) { break }
}

$targetNormalized = $false
try {
  if (Test-Path -LiteralPath $p.RequirementTarget) {
    $target = Get-Content -LiteralPath $p.RequirementTarget -Raw | ConvertFrom-Json
    $targetReqs = @($target.requirements)
    if ($targetReqs.Count -gt 0 -and @($targetReqs | Where-Object { $_.status -eq "CANDIDATE" -or $_.normalized -eq $false }).Count -eq 0) {
      $targetNormalized = $true
    }
  }
} catch {}
$status = if ($targetNormalized) { "PASS" } elseif ($requirements.Count -gt 0) { "CANDIDATE" } else { "MANUAL_REVIEW_REQUIRED" }
@{
  schemaVersion = $AE_SCHEMA_VERSION
  candidates = $requirements
  generatedAt = (Get-Date).ToString("s")
  status = $(if ($requirements.Count -gt 0) { "CANDIDATE" } else { "MANUAL_REVIEW_REQUIRED" })
  note = $(if ($requirements.Count -gt 0) { "Auto-extracted requirements are candidates only. Agent must normalize them into P0/P1/P2 acceptance criteria with surface/test/evidence before implementation or final PASS." } else { "No requirements auto-extracted. Agent must fill from PRD/docs." })
} | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.RequirementCandidates

if (!(Test-Path -LiteralPath $p.RequirementTarget)) {
  @{ schemaVersion = $AE_SCHEMA_VERSION; requirements = @(); generatedAt = (Get-Date).ToString("s"); status = "PENDING"; note = "Normalize requirement-candidates.json into this file. This target file must not contain CANDIDATE items for final PASS." } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $p.RequirementTarget
}

Add-EvidenceItem $ProjectRoot "other" $p.RequirementCandidates "requirement candidates"
Add-EvidenceItem $ProjectRoot "other" $p.RequirementTarget "requirement target"
Add-VerificationResult $ProjectRoot "requirements-candidates" $status "Requirement candidates generated with $($requirements.Count) candidate item(s); requirement-target normalized=$targetNormalized" $p.RequirementTarget
Write-LaneResult $ProjectRoot "requirements-candidates" $(if ($status -eq "CANDIDATE") { "MANUAL_REVIEW_REQUIRED" } else { $status }) @() @((Get-RelativeEvidencePath $ProjectRoot $p.RequirementCandidates),(Get-RelativeEvidencePath $ProjectRoot $p.RequirementTarget)) $(if ($status -eq "PASS") { @() } elseif ($requirements.Count -eq 0) { @("No requirements auto-extracted") } else { @("Auto-extracted requirements are candidates and must be normalized into requirement-target.json") }) $(if ($status -eq "PASS") { @("Keep requirement-target.json normalized; candidate extraction is informational only.") } else { @("Normalize requirement-candidates.json into requirement-target.json before final convergence.") })
Write-Host "[$status] requirements-candidates: $($requirements.Count) item(s)"
