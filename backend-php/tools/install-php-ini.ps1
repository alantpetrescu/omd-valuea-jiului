<#
.SYNOPSIS
    Creates a php.ini next to php.exe with the extensions this backend needs.

.DESCRIPTION
    A fresh Windows PHP build ships php.ini-development and php.ini-production
    but no php.ini, so PHP starts with only its built-in extensions — which is
    why pdo_mysql and mbstring appear to be "missing" when nothing is actually
    wrong with the installation.

    This copies php.ini-development into place and uncomments the four
    extensions the backend uses, plus extension_dir.

    The PHP directory usually sits under Program Files, so this needs an
    elevated PowerShell. Right-click PowerShell -> Run as administrator.

.EXAMPLE
    .\install-php-ini.ps1

.EXAMPLE
    .\install-php-ini.ps1 -PhpDir 'C:\php'
#>

[CmdletBinding()]
param(
    # Where php.exe lives. Found automatically when PHP is on PATH.
    [string] $PhpDir
)

$ErrorActionPreference = 'Stop'

if (-not $PhpDir) {
    $cmd = Get-Command php -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "php nu este in PATH. Ruleaza cu -PhpDir 'C:\cale\catre\php'."
    }
    $PhpDir = Split-Path $cmd.Source -Parent
}

$php = Join-Path $PhpDir 'php.exe'
if (-not (Test-Path $php)) { throw "Nu gasesc php.exe in $PhpDir" }

Write-Host "PHP : $php"
Write-Host "      $(& $php -r 'echo PHP_VERSION;')"

$target = Join-Path $PhpDir 'php.ini'
$source = Join-Path $PhpDir 'php.ini-development'
if (-not (Test-Path $source)) { throw "Nu gasesc $source" }

if (Test-Path $target) {
    # Never overwrite an existing configuration without a copy: it may carry
    # settings nothing here knows about.
    $backup = "$target.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $target $backup
    Write-Host "php.ini exista deja; copie de siguranta: $backup"
} else {
    Copy-Item $source $target
    Write-Host "creat php.ini din php.ini-development"
}

$text = Get-Content $target -Raw

# An absolute extension_dir: a relative one resolves against the working
# directory, not against php.ini, so `php` would work in one folder and fail
# in the next.
$extDir = (Join-Path $PhpDir 'ext') -replace '\\', '\'
if ($text -match '(?m)^\s*;?\s*extension_dir\s*=') {
    $text = $text -replace '(?m)^\s*;?\s*extension_dir\s*=.*$', "extension_dir = `"$extDir`""
} else {
    $text += "`r`nextension_dir = `"$extDir`"`r`n"
}

# The four the application actually needs — the same four bin/check-environment.php
# verifies. An earlier version also enabled openssl and fileinfo, on the belief
# that the export and upload paths used them; nothing in src/ calls a function
# from either. The crypto is core (random_bytes, hash_hmac, password_hash), and
# a file's type comes from the package's data: URI rather than from detection.
$needed = 'pdo_mysql', 'mbstring', 'json', 'filter'
foreach ($ext in $needed) {
    if ($text -match "(?m)^\s*extension\s*=\s*$ext\s*$") { continue }
    if ($text -match "(?m)^\s*;\s*extension\s*=\s*$ext\s*$") {
        $text = $text -replace "(?m)^\s*;\s*extension\s*=\s*$ext\s*$", "extension=$ext"
    } else {
        $text += "`r`nextension=$ext`r`n"
    }
}

Set-Content -Path $target -Value $text -Encoding UTF8 -NoNewline
Write-Host "scris  : $target"

Write-Host ''
Write-Host '--- verificare ---'
& $php --ini | Select-String 'Loaded Configuration File'

$loaded = & $php -m
$missing = $needed | Where-Object { $loaded -notcontains $_ }

foreach ($ext in $needed) {
    $ok = $loaded -contains $ext
    Write-Host ("  {0,-10} {1}" -f $ext, $(if ($ok) { 'incarcata' } else { 'LIPSESTE' }))
}

if ($missing) {
    Write-Host ''
    Write-Host "Nu s-au incarcat: $($missing -join ', ')"
    Write-Host "Verifica daca exista fisierele php_<nume>.dll in $extDir"
    exit 1
}

Write-Host ''
Write-Host 'Gata. Deschide o consola noua si ruleaza:'
Write-Host '  php bin\check-environment.php'
