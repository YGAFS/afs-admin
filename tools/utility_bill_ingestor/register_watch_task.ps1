param(
    [string]$TaskName = "Utility Bill Ingestor"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Join-Path $ScriptDir "run_watch.bat"

$Action = New-ScheduledTaskAction -Execute $RunScript -WorkingDirectory $ScriptDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit 0 `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Watches the utility bill inbox folder and auto-registers new PDF bills. Starts at logon and restarts one minute after an unexpected exit." -Force

Write-Host "Registered scheduled task '$TaskName' to start the watcher at logon."
Write-Host "To start it right now without logging out: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "To stop it: Stop-ScheduledTask -TaskName '$TaskName' (or just close the console window)"
Write-Host "To remove it: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
