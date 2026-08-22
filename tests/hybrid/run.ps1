<#
.SYNOPSIS
  Suita hibridă — frontendul real peste backendul real, pe `omd_vj_test`.

.DESCRIPTION
  Pornește serverul PHP încorporat și un server Vite care îi trimite `/api` și
  `/uploads`, apoi conduce un browser prin parcursuri complete.

  Singura suită care scrie prin ambele straturi deodată. De aceea baza e
  `omd_vj_test` și de aceea rulează `cleanup.php` la final, orice s-ar întâmpla
  între timp.

.PARAMETER Only
  journeys | screens. Implicit: amândouă.
#>
[CmdletBinding()]
param(
    [ValidateSet('journeys', 'screens')]
    [string[]] $Only
)

$ErrorActionPreference = 'Stop'

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$tests    = Split-Path -Parent $here
$repo     = Split-Path -Parent $tests
$frontend = Join-Path $repo 'frontend'
$backend  = Join-Path $repo 'backend-php'
$work     = Join-Path $tests '.work'

$apiPort = if ($env:OMD_TEST_PORT) { [int] $env:OMD_TEST_PORT } else { 8099 }
$appPort = if ($env:OMD_APP_PORT)  { [int] $env:OMD_APP_PORT }  else { 5175 }
$database = if ($env:OMD_TEST_DB)  { $env:OMD_TEST_DB }         else { 'omd_vj_test' }

$suites = if ($Only) { $Only } else { @('journeys', 'screens') }

# The same rule the PHP harness enforces, checked before anything starts: these
# journeys create, rename and delete. Pointed at staging they would damage real
# work, and by the time anyone noticed the run would be over.
if (-not $database.EndsWith('_test')) {
    Write-Host "Refuz să rulez pe „$database”: numele bazei trebuie să se termine în _test." -ForegroundColor Red
    exit 2
}

New-Item -ItemType Directory -Force -Path $work | Out-Null

$processes = @()
$failed = 0

function Write-Step([string] $title) {
    Write-Host ''
    Write-Host "== $title" -ForegroundColor White
}

function Test-Port([int] $port, [string] $path) {
    try {
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:$port$path" -TimeoutSec 2 -UseBasicParsing
        return $true
    } catch {
        return $false
    }
}


function Assert-PortFree([int] $port, [string] $what) {
    <#
      A busy port is not a warning, it is the end of the run.

      Vite answers "Port N is in use, trying another one..." and quietly moves to
      the next free one. Everything after that probes the port it was told to,
      gets an answer from whatever leftover process is sitting there, and reports
      results for an application nobody started. That cost a debugging session:
      ten stale servers held :5175 through :5184 and the suite was talking to the
      oldest of them.
    #>
    $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        $owner = (Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Host "Portul $port este ocupat de $owner (PID $($busy[0].OwningProcess)) — $what nu poate porni acolo." -ForegroundColor Red
        Write-Host 'Oprește procesul sau alege alt port cu variabila de mediu potrivită.' -ForegroundColor Red
        exit 2
    }
}

function Wait-For([int] $port, [string] $path, [int] $seconds, [string] $what) {
    for ($i = 0; $i -lt ($seconds * 2); $i++) {
        if (Test-Port $port $path) { return $true }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "$what nu a pornit pe :$port" -ForegroundColor Red
    return $false
}

try {
    # A leftover listener on the API port is the failure that looks like success:
    # the readiness probe answers, and the whole run then talks to stale code
    # against whatever database that process was given.
    Assert-PortFree $apiPort 'serverul PHP'

    if (Test-Port $apiPort '/api/v1/health') {
        Write-Host "Ceva răspunde deja pe :$apiPort — oprește-l sau setează OMD_TEST_PORT." -ForegroundColor Red
        exit 2
    }

    Write-Step "Server PHP pe :$apiPort, baza $database"

    # `variables_order=EGPCS`: no web SAPI copies the process environment into the
    # superglobals, so without the E the server reads `.env` and answers from
    # staging — with the tests believing they are on `omd_vj_test`.
    $env:DB_NAME = $database
    $env:APP_ENV = 'staging'

    $php = Start-Process -FilePath 'php' `
        -ArgumentList @(
            '-d', 'variables_order=EGPCS',
            '-S', "127.0.0.1:$apiPort",
            '-t', (Join-Path $backend 'public'),
            (Join-Path $backend 'public/index.php')
        ) `
        -WorkingDirectory $backend -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $work 'hybrid-php.log') `
        -RedirectStandardError  (Join-Path $work 'hybrid-php.err')
    $processes += $php

    if (-not (Wait-For $apiPort '/api/v1/health' 30 'Serverul PHP')) { exit 2 }

    Assert-PortFree $appPort 'serverul Vite'

    Write-Step "Server Vite pe :$appPort, cu /api către :$apiPort"

    # `API_TARGET` is what `vite.config.ts` reads for its proxy, so the browser
    # sees one origin and the session cookie works without CORS — the same
    # arrangement production has behind Apache.
    $env:API_TARGET = "http://127.0.0.1:$apiPort"

    $viteBin = Join-Path $frontend 'node_modules/vite/bin/vite.js'
    $vite = Start-Process -FilePath 'node' `
        -ArgumentList @($viteBin, '--host', '127.0.0.1', '--port', "$appPort", '--strictPort') `
        -WorkingDirectory $frontend -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $work 'hybrid-vite.log') `
        -RedirectStandardError  (Join-Path $work 'hybrid-vite.err')
    $processes += $vite

    if (-not (Wait-For $appPort '/' 40 'Serverul Vite')) { exit 2 }

    $env:OMD_APP_URL = "http://127.0.0.1:$appPort/strategic"
    $env:OMD_API_URL = "http://127.0.0.1:$apiPort"

    # The suite logs in as these three; the PHP harness is what creates them.
    Write-Step 'Conturi de test'
    & php (Join-Path $tests 'hybrid/ensure-users.php')
    if ($LASTEXITCODE -ne 0) { exit 2 }

    if ($suites -contains 'screens') {
        Write-Step 'Ecrane peste backendul real'
        & node (Join-Path $here 'screens.spec.mjs')
        if ($LASTEXITCODE -ne 0) { $failed = 1 }
    }

    if ($suites -contains 'journeys') {
        Write-Step 'Parcursuri complete — H-01…H-07'
        & node (Join-Path $here 'journeys.spec.mjs')
        if ($LASTEXITCODE -ne 0) { $failed = 1 }
    }
} finally {
    # Cleanup before the servers go down: it talks to the same database, and a
    # run that failed halfway is exactly the run that left something behind.
    Write-Step 'Curățenie'
    & php (Join-Path $here 'cleanup.php')

    foreach ($process in $processes) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'HIBRID: toate verificările au trecut' -ForegroundColor Green
} else {
    Write-Host 'HIBRID: eșecuri — vezi mai sus' -ForegroundColor Red
}
exit $failed
