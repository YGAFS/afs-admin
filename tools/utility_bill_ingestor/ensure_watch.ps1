<#!
.SYNOPSIS
Ensures the Utility Bill Ingestor watcher is running.

.DESCRIPTION
Safe to invoke repeatedly from Task Scheduler. If the watch process is
already active, this exits immediately; otherwise, it starts it hidden.
#>

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = Join-Path $ScriptDir '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $PythonExe)) {
    throw "Utility Bill Ingestor virtual environment was not found: $PythonExe"
}

$WatcherRunning = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object {
        $_.ExecutablePath -eq $PythonExe -and
        $_.CommandLine -match '(?i)-m\s+app\.main\s+watch'
    } |
    Select-Object -First 1

if ($WatcherRunning) {
    exit 0
}

Start-Process -FilePath $PythonExe -ArgumentList '-m', 'app.main', 'watch' -WorkingDirectory $ScriptDir -WindowStyle Hidden
