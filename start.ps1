param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Fuer den Entwicklungsstart bitte Node.js 22.12 oder neuer installieren. Die veroeffentlichte Browser-Version benoetigt keine Installation.'
}
if (-not (Test-Path 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Abhaengigkeiten konnten nicht installiert werden.' }
}
if ($NoBrowser) { & npm.cmd run dev } else { & npm.cmd run dev -- --open }
exit $LASTEXITCODE
