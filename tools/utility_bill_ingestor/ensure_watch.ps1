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

# Get-CimInstance/CommandLine requires elevated WMI access on some Windows
# installations. The watcher is the only long-running process using this
# virtual environment, so checking the executable path is sufficient and
# works under a normal signed-in user's account as well.
$WatcherRunning = Get-Process -Name 'python' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $PythonExe } |
    Select-Object -First 1

if ($WatcherRunning) {
    exit 0
}

Start-Process -FilePath $PythonExe -ArgumentList '-m', 'app.main', 'watch' -WorkingDirectory $ScriptDir -WindowStyle Hidden
