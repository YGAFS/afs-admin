<#!
.SYNOPSIS
Keeps the Utility Bill Ingestor watcher available after user sign-in.

.DESCRIPTION
Launched hidden from the current user's Windows Run key. It checks once per
minute whether the watcher is active and starts it when needed.
#>

$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnsureScript = Join-Path $ScriptDir 'ensure_watch.ps1'

while ($true) {
    & $EnsureScript
    Start-Sleep -Seconds 60
}
