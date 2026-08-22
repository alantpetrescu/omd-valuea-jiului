<#
.SYNOPSIS
  Suita de frontend — funcții pure, ecrane, și paritatea vizuală.

.DESCRIPTION
  Pornește serverul Vite și un API fals alimentat din DEMO_SEED, apoi conduce un
  browser prin ecrane. Nu atinge nicio bază de date: ce are nevoie de backendul
  real e în `tests/hybrid`.

  Mock-ul se repornește cu alt rol acolo unde un test are nevoie de altul —
  sesiunea e a procesului, nu a cererii.

.PARAMETER Only
  unit | admin | parity. Implicit: primele două. `parity` e cea mai lentă și se
  cere explicit sau prin -All.

  Ecranele operaționale — campanii, activări, monitorizare — nu sunt aici: au
  nevoie de date pe care mock-ul nu le are, așa că rulează în `tests/hybrid`,
  peste backendul real.

.EXAMPLE
  pwsh tests/frontend/run.ps1
  pwsh tests/frontend/run.ps1 -Only unit
  pwsh tests/frontend/run.ps1 -All
#>
[CmdletBinding()]
param(
    [ValidateSet('unit', 'admin', 'parity')]
    [string[]] $Only,

    [switch] $All
)

$ErrorActionPreference = 'Stop'

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$tests    = Split-Path -Parent $here
$repo     = Split-Path -Parent $tests
$frontend = Join-Path $repo 'frontend'
$work     = Join-Path $tests '.work'

$mockPort = if ($env:OMD_MOCK_PORT) { [int] $env:OMD_MOCK_PORT } else { 3000 }
$appPort  = if ($env:OMD_APP_PORT)  { [int] $env:OMD_APP_PORT }  else { 5174 }

$suites = if ($Only) { $Only } elseif ($All) { @('unit', 'admin', 'parity') } else { @('unit', 'admin') }

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

# The mock is one process holding one role, so switching role means restarting
# it. `Stop-Process` on the handle we started, never a name match: killing "node"
# by name would take the Vite server with it.
$script:mock = $null

function Start-Mock([string] $role, [string] $legacy = '0', [string] $adminStrategy = '1') {
    if ($script:mock -and -not $script:mock.HasExited) {
        Stop-Process -Id $script:mock.Id -Force -ErrorAction SilentlyContinue
        $script:mock.WaitForExit(5000) | Out-Null
    }

    $env:ROLE = $role

    <#
      `ADMIN_STRATEGY=1` adds a `P5.10` programme and a second strategy version.
      The Administrare suite needs both — natural ordering and cloning cannot be
      tested without them — and the parity suite must not have them: they are not
      in the prototype's seed, so every one of the 22 states would differ by one
      extra row and the comparison would measure the fixture instead of the
      rendering.
    #>
    $env:ADMIN_STRATEGY = $adminStrategy

    # `LEGACY=1` makes the mock answer `GET /strategy` the way an older backend
    # did — without `campaigns` and `audiences`. One spec needs exactly that, and
    # every other one needs it off.
    $env:LEGACY = $legacy

    $suffix = if ($legacy -eq '1') { "$role-legacy" } else { $role }

    $script:mock = Start-Process -FilePath 'node' `
        -ArgumentList (Join-Path $tests 'shared/mock-api.mjs') `
        -WorkingDirectory $repo -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $work "mock-$suffix.log") `
        -RedirectStandardError  (Join-Path $work "mock-$suffix.err")

    $script:processes += $script:mock

    if (-not (Wait-For $mockPort '/api/v1/auth/me' 15 "Mock-ul ca $role")) { exit 2 }
}

function Invoke-Spec([string] $name, [string] $file) {
    Write-Step $name
    & node (Join-Path $here $file)
    if ($LASTEXITCODE -ne 0) { $script:failed = 1 }
}

try {
    # --- Funcții pure: nu au nevoie de nimic pornit --------------------------
    if ($suites -contains 'unit') {
        Write-Step 'Funcții pure — src/domain'
        & node (Join-Path $here 'unit.mjs')
        if ($LASTEXITCODE -ne 0) { $failed = 1 }
    }

    $needsBrowser = @('admin', 'parity') | Where-Object { $suites -contains $_ }
    if (-not $needsBrowser) { exit $failed }

    # A real API answering on the mock's port would silently take over: the tests
    # would pass or fail against staging data and nothing would say so.
    if (Test-Port $mockPort '/api/v1/health') {
        Write-Host "API-ul real răspunde pe :$mockPort — oprește-l sau setează OMD_MOCK_PORT." -ForegroundColor Red
        exit 2
    }

    Write-Step 'Fixture din OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json'
    & node (Join-Path $here 'visual-parity/make-fixture.mjs')
    if ($LASTEXITCODE -ne 0) { exit 2 }

    Assert-PortFree $appPort 'serverul Vite'

    Write-Step "Server Vite pe :$appPort"

    # Vite's own entry script, run by node directly.
    #
    # `npx` is a shell wrapper (`npx.cmd` here), and `Start-Process` cannot launch
    # one: it reports "%1 is not a valid Win32 application". Naming the .js means
    # the same line works on every platform.
    $viteBin = Join-Path $frontend 'node_modules/vite/bin/vite.js'
    $vite = Start-Process -FilePath 'node' `
        -ArgumentList @($viteBin, '--host', '127.0.0.1', '--port', "$appPort", '--strictPort') `
        -WorkingDirectory $frontend -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $work 'vite.log') `
        -RedirectStandardError  (Join-Path $work 'vite.err')
    $processes += $vite

    Start-Mock 'ADMIN'
    if (-not (Wait-For $appPort '/' 40 'Serverul Vite')) { exit 2 }

    if ($suites -contains 'admin') {
        Invoke-Spec 'Administrare → Strategie' 'admin-strategy.spec.mjs'
        Invoke-Spec 'Modale de creare și editare' 'admin-edit.spec.mjs'

        # This one wants the old payload shape, so the mock is restarted for it
        # and restarted again afterwards. Left on, `LEGACY=1` would make every
        # following spec see a strategy screen with no campaigns in it.
        Start-Mock 'ADMIN' '1'
        Invoke-Spec 'API învechit — diagnosticat, nu ecran alb' 'stale-api.spec.mjs'
        Start-Mock 'ADMIN'

        Write-Step 'Poarta de rol pe /admin'
        foreach ($role in @('ADMIN', 'EDITOR', 'VIEWER')) {
            if ($role -ne 'ADMIN') { Start-Mock $role }
            $env:ROLE = $role
            & node (Join-Path $here 'role-gate.spec.mjs')
            if ($LASTEXITCODE -ne 0) { $failed = 1 }
        }
        Start-Mock 'ADMIN'
    }

    if ($suites -contains 'parity') {
        $protoPort = if ($env:OMD_PROTO_PORT) { [int] $env:OMD_PROTO_PORT } else { 8811 }

        Write-Step 'Prototipul v13.3, pregătit și servit'
        & node (Join-Path $here 'visual-parity/stage.mjs')
        if ($LASTEXITCODE -ne 0) { exit 2 }

        Assert-PortFree $protoPort 'serverul prototipului'

        $proto = Start-Process -FilePath 'node' `
            -ArgumentList (Join-Path $here 'visual-parity/serve.mjs') `
            -WorkingDirectory $repo -PassThru -NoNewWindow `
            -RedirectStandardOutput (Join-Path $work 'proto.log') `
            -RedirectStandardError  (Join-Path $work 'proto.err')
        $processes += $proto

        if (-not (Wait-For $protoPort '/index.html' 20 'Serverul prototipului')) { exit 2 }

        <#
          Captured as VIEWER, then again as ADMIN.

          The screen is a read-only projection of the strategic repere — editing
          them lives in Administrare (D-002) — so it has to be pixel-identical
          whoever is looking at it. An administrator seeing an extra button here
          would be a deviation from the prototype, not a convenience.
        #>
        Start-Mock 'VIEWER' '0' '0'

        Write-Step 'Paritate vizuală — capturi'
        foreach ($side in @('proto', 'react')) {
            foreach ($mode in @('static', 'interactive')) {
                $env:SIDE = $side
                $env:MODE = $mode
                & node (Join-Path $here 'visual-parity/capture.mjs')
                if ($LASTEXITCODE -ne 0) { $failed = 1 }
            }
        }

        Write-Step 'Paritate vizuală — comparație'
        foreach ($mode in @('static', 'interactive')) {
            $env:MODE = $mode
            & node (Join-Path $here 'visual-parity/compare.mjs')
            if ($LASTEXITCODE -ne 0) { $failed = 1 }
        }

        Write-Step 'Paritate vizuală — aceleași stări, ca ADMIN'
        Start-Mock 'ADMIN' '0' '0'
        $env:SIDE = 'react'
        $env:MODE = 'static'
        & node (Join-Path $here 'visual-parity/capture.mjs')
        if ($LASTEXITCODE -ne 0) { $failed = 1 }
        & node (Join-Path $here 'visual-parity/compare.mjs')
        if ($LASTEXITCODE -ne 0) { $failed = 1 }

        Remove-Item Env:SIDE, Env:MODE -ErrorAction SilentlyContinue
    }
} finally {
    foreach ($process in $processes) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'FRONTEND: toate verificările au trecut' -ForegroundColor Green
} else {
    Write-Host 'FRONTEND: eșecuri — vezi mai sus' -ForegroundColor Red
}
exit $failed
