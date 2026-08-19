param(
    [string]$BaseTaskName = "Outlook Mail Sorter Admin AFS",
    [string]$At = "08:20",
    [int]$RepeatMinutes = 60
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Join-Path $ScriptDir "run_daily_admin_afs.ps1"
$TaskCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScript`""
$UserName = "$env:USERDOMAIN\$env:USERNAME"
$MinuteTask = $BaseTaskName
$LogonTask = "$BaseTaskName Logon Catch-up"

schtasks /Create /TN $MinuteTask /TR $TaskCommand /SC MINUTE /MO $RepeatMinutes /ST $At /RU $UserName /F | Out-Host
schtasks /Create /TN $LogonTask /TR $TaskCommand /SC ONLOGON /RU $UserName /F | Out-Host

Write-Host "Registered scheduled tasks '$MinuteTask' and '$LogonTask' with hidden PowerShell windows, repeating every $RepeatMinutes minutes starting at $At."
