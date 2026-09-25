# PowerShell variant. Reads the same environment variables.
$token = $env:GITHUB_TOKEN
$outDir = Join-Path $env:USERPROFILE "release-notes"
Write-Host "Drafting into $outDir"
