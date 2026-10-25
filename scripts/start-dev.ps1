param([switch]$Tailnet, [switch]$Help)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launchArgs = @()
if ($Help) { $launchArgs += '--help' }
if ($Tailnet) { $launchArgs += '--tailnet' }
Push-Location $projectRoot
try {
  & npm.cmd run dev -- @launchArgs
  exit $LASTEXITCODE
} finally { Pop-Location }
