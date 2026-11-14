# Dot-sourced by dev.ps1 and build.ps1: applies the machine's build setup to this process only.
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$local = Join-Path $repo "machines\$($env:COMPUTERNAME).toml"
$default = Join-Path $repo "machines\_default.toml"

if (Test-Path $local) {
    $file = $local
    Write-Output "profile: local"
} else {
    $file = $default
    Write-Output "profile: default"
}

$toolchain = $null
$paths = @()
foreach ($line in Get-Content $file) {
    if ($line -match '^\s*toolchain\s*=\s*"([^"]+)"') {
        $toolchain = $Matches[1]
    } elseif ($line -match '^\s*path\s*=\s*\[(.*)\]') {
        $paths = @([regex]::Matches($Matches[1], '"([^"]*)"') | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_.Groups[1].Value) })
    }
}
if (-not $toolchain) { throw "machine file has no toolchain" }

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$env:Path = (@($paths) + @($cargoBin) + @($env:Path)) -join ";"
$env:RUSTUP_TOOLCHAIN = $toolchain
Set-Location $repo
