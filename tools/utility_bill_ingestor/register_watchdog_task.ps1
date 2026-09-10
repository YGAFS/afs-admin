param(
    [string]$TaskName = 'Utility Bill Ingestor Watchdog'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnsureScript = Join-Path $ScriptDir 'ensure_watch.ps1'
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$Action = New-ScheduledTaskAction `
    -Execute $PowerShellExe `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$EnsureScript`""
$LogonTrigger = New-ScheduledTaskTrigger -AtLogOn
$RecurringTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($LogonTrigger, $RecurringTrigger) -Settings $Settings `
    -Description 'Checks the Utility Bill Ingestor every minute and restarts the watcher after a restart or unexpected exit.' -Force

Write-Host "Registered scheduled task '$TaskName'."
Write-Host "The watcher starts at logon and is checked every minute."
