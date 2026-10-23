param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$appUrl = 'http://127.0.0.1:8787'
$appRoot = $PSScriptRoot
$runtimeRoot = Join-Path $appRoot '.runtime'

function Get-FormraumHealth {
    try {
        return Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
    } catch {
        return $null
    }
}

function Test-LocalPort {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.ConnectAsync('127.0.0.1', 8787)
        return ($connect.Wait(500) -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

try {
    $health = Get-FormraumHealth
    if ($health -and $health.ok -and $health.app -eq 'formraum-local-cad') {
        Write-Host "Formraum laeuft bereits: $appUrl"
    } else {
        if (Test-LocalPort) {
            throw 'Port 8787 wird bereits von einem anderen oder noch nicht bereiten Programm belegt. Dieses Programm zuerst schliessen und erneut starten.'
        }
        $cadPython = $env:FORMRAUM_FREECAD_PYTHON
        if (-not $cadPython) {
            $cadPython = Join-Path $env:LOCALAPPDATA 'Programs\FreeCAD 1.0\bin\python.exe'
        }
        if (-not (Test-Path -LiteralPath $cadPython -PathType Leaf)) {
            throw "FreeCAD-Python nicht gefunden: $cadPython. FreeCAD 1.0 installieren oder FORMRAUM_FREECAD_PYTHON auf dessen python.exe setzen."
        }
        New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
        $backendPath = Join-Path $appRoot 'backend.py'
        $stdoutPath = Join-Path $runtimeRoot 'server.log'
        $stderrPath = Join-Path $runtimeRoot 'server-error.log'
        $serverProcess = Start-Process -FilePath $cadPython -ArgumentList @(('"' + $backendPath + '"'), '--port', '8787') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $ready = $false
        while ([DateTime]::UtcNow -lt $deadline) {
            $health = Get-FormraumHealth
            if ($health -and $health.ok -and $health.app -eq 'formraum-local-cad') {
                $ready = $true
                break
            }
            if ($serverProcess.HasExited) {
                throw "Der CAD-Server wurde beendet. Details: $stderrPath"
            }
            Start-Sleep -Milliseconds 350
        }
        if (-not $ready) {
            throw "Der CAD-Server ist nach 30 Sekunden noch nicht bereit. Details: $stderrPath"
        }
        Write-Host "Formraum ist bereit: $appUrl"
    }
    if (-not $NoBrowser) {
        Start-Process $appUrl
    }
    exit 0
} catch {
    Write-Host "Formraum konnte nicht gestartet werden: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
