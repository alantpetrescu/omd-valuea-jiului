<#
.SYNOPSIS
  Pregătește `omd_vj_test`: migrații plus cele patru pachete demo.

.DESCRIPTION
  Se rulează o dată, înainte de prima suită, și din nou doar când schema se
  schimbă. Nu e parte din `run.ps1`: un import la fiecare rulare ar costa
  secunde și, mai important, ar rescrie exact datele pe care testele tocmai
  le-au verificat.

  Fără pachetul de activări și cel de monitorizare, o parte din suită nu are ce
  să verifice — și un test care nu are ce verifica trece, ceea ce e mai rău
  decât unul care pică.

.PARAMETER Packages
  Calea către `04_DEMO_SEEDS`. Implicit, pachetul de predare de lângă depozit.

.EXAMPLE
  pwsh tests/seed.ps1
#>
[CmdletBinding()]
param(
    [string] $Packages
)

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo    = Split-Path -Parent $here
$backend = Join-Path $repo 'backend-php'

$database = if ($env:OMD_TEST_DB) { $env:OMD_TEST_DB } else { 'omd_vj_test' }

# The same rule the harness enforces. These commands create tables and write
# rows; pointed at staging they would overwrite real work with demo data.
if (-not $database.EndsWith('_test')) {
    Write-Host "Refuz să rulez pe „$database”: numele bazei trebuie să se termine în _test." -ForegroundColor Red
    exit 2
}

if (-not $Packages) {
    $Packages = if ($env:OMD_PACKAGE_DIR) {
        Join-Path $env:OMD_PACKAGE_DIR '04_DEMO_SEEDS'
    } else {
        Join-Path (Split-Path -Parent $repo) 'programmer_full_package_FINAL/04_DEMO_SEEDS'
    }
}

if (-not (Test-Path $Packages)) {
    Write-Host "Nu găsesc pachetele demo la „$Packages”." -ForegroundColor Red
    Write-Host 'Dă calea cu -Packages sau setează OMD_PACKAGE_DIR.' -ForegroundColor Red
    exit 2
}

$env:DB_NAME = $database
$env:APP_ENV = 'staging'

Write-Host "Baza de test: $database" -ForegroundColor White

Write-Host ''
Write-Host '== Migrații' -ForegroundColor White
& php (Join-Path $backend 'bin/migrate.php')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

<#
  Order matters, and it is the operator's to give.

  The importer processes files exactly as handed over — it does not sort and does
  not reorder — so campaigns go before activations, and activations before the
  monitoring that hangs off their materials. Handed over the other way round it
  fails cleanly, which `B-I-03` in the backend suite pins down.
#>
$order = @(
    'OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json',
    'OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json',
    'OMD_ACTIVATION_MONITORING_PACKAGE_DEMO_SEED_v1.json',
    'OMD_REPUTATION_MONITORING_PACKAGE_DEMO_SEED_v1.json'
)

Write-Host ''
Write-Host '== Pachete demo' -ForegroundColor White

foreach ($name in $order) {
    $file = Join-Path $Packages $name
    if (-not (Test-Path $file)) {
        Write-Host "  lipsește: $name" -ForegroundColor Yellow
        continue
    }

    & php (Join-Path $backend 'bin/import.php') $file
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Importul a eșuat la $name." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host ''
Write-Host "Baza $database este pregătită." -ForegroundColor Green
