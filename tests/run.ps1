<#
.SYNOPSIS
  Toată suita: backend, frontend, hibrid.

.DESCRIPTION
  Specificațiile sunt în `docs/tests-specs/`. Aici e doar comanda.

    pwsh tests/run.ps1                 # tot, în ordine
    pwsh tests/run.ps1 -Only backend
    pwsh tests/run.ps1 -Only frontend
    pwsh tests/run.ps1 -Only hybrid
    pwsh tests/run.ps1 -SkipParity     # fără cele 22 de capturi

  Ordinea nu e alfabetică. Backendul e primul fiindcă e cel mai rapid și fiindcă
  o regulă stricată acolo explică jumătate din eșecurile de mai sus; hibridul e
  ultimul fiindcă e singurul care scrie prin ambele straturi deodată.

  Precondiții, o singură dată:

    pwsh tests/seed.ps1                # omd_vj_test: migrații + pachete demo
    cd frontend; pnpm install
    npx playwright install chromium

.PARAMETER Only
  backend | frontend | hybrid. Implicit: toate trei.

.PARAMETER SkipParity
  Sare peste paritatea vizuală — jumătate din durata suitei de frontend.
#>
[CmdletBinding()]
param(
    [ValidateSet('backend', 'frontend', 'hybrid')]
    [string[]] $Only,

    [switch] $SkipParity
)

$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here

$suites = if ($Only) { $Only } else { @('backend', 'frontend', 'hybrid') }

$started = Get-Date
$results = @()

function Write-Banner([string] $title) {
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor DarkGray
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor DarkGray
}

# --- Backend -------------------------------------------------------------------

if ($suites -contains 'backend') {
    Write-Banner 'BACKEND — reguli, schemă, API'
    $clock = [System.Diagnostics.Stopwatch]::StartNew()

    & php (Join-Path $here 'backend/run.php')
    $code = $LASTEXITCODE

    $clock.Stop()
    $results += [pscustomobject]@{ Suite = 'backend'; Ok = ($code -eq 0); Seconds = [int] $clock.Elapsed.TotalSeconds }
}

# --- Frontend ------------------------------------------------------------------

if ($suites -contains 'frontend') {
    Write-Banner 'FRONTEND — funcții pure, Administrare, paritate vizuală'
    $clock = [System.Diagnostics.Stopwatch]::StartNew()

    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', (Join-Path $here 'frontend/run.ps1')
    )
    if (-not $SkipParity) { $arguments += '-All' }

    & powershell @arguments
    $code = $LASTEXITCODE

    $clock.Stop()
    $results += [pscustomobject]@{ Suite = 'frontend'; Ok = ($code -eq 0); Seconds = [int] $clock.Elapsed.TotalSeconds }
}

# --- Hibrid --------------------------------------------------------------------

if ($suites -contains 'hybrid') {
    Write-Banner 'HIBRID — frontendul real peste backendul real'
    $clock = [System.Diagnostics.Stopwatch]::StartNew()

    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'hybrid/run.ps1')
    $code = $LASTEXITCODE

    $clock.Stop()
    $results += [pscustomobject]@{ Suite = 'hybrid'; Ok = ($code -eq 0); Seconds = [int] $clock.Elapsed.TotalSeconds }
}

# --- Raport --------------------------------------------------------------------

$elapsed = [int] ((Get-Date) - $started).TotalSeconds

Write-Host ''
Write-Host ('=' * 72) -ForegroundColor DarkGray

foreach ($result in $results) {
    $mark = if ($result.Ok) { 'OK  ' } else { 'EȘEC' }
    $colour = if ($result.Ok) { 'Green' } else { 'Red' }
    Write-Host ("  {0,-4}  {1,-10} {2,4}s" -f $mark, $result.Suite, $result.Seconds) -ForegroundColor $colour
}

Write-Host ('=' * 72) -ForegroundColor DarkGray

# The five-minute budget from the mother specification, checked rather than
# assumed: it is the threshold at which a suite gets run after every change
# instead of only before a delivery, and a suite nobody runs protects nothing.
$budget = 300
if ($elapsed -gt $budget) {
    Write-Host "  Durata totală: ${elapsed}s — peste bugetul de ${budget}s." -ForegroundColor Yellow
} else {
    Write-Host "  Durata totală: ${elapsed}s, din ${budget}s." -ForegroundColor DarkGray
}

$failed = @($results | Where-Object { -not $_.Ok }).Count
exit ([Math]::Min($failed, 1))
