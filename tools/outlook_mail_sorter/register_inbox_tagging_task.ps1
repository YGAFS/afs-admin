param(
    [string]$BaseTaskName = "Outlook Inbox Tagging",
    [string]$At = "08:15",
    [int]$RepeatMinutes = 10
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunScript = Join-Path $ScriptDir "run_inbox_tagging_hidden.vbs"
$TaskCommand = "wscript.exe `"$RunScript`""
$UserName = "$env:USERDOMAIN\$env:USERNAME"
$MinuteTask = $BaseTaskName
$LogonTask = "$BaseTaskName Logon Catch-up"

schtasks /Create /TN $MinuteTask /TR $TaskCommand /SC MINUTE /MO $RepeatMinutes /ST $At /RU $UserName /F | Out-Host
schtasks /Create /TN $LogonTask /TR $TaskCommand /SC ONLOGON /RU $UserName /F | Out-Host

Write-Host "Registered scheduled tasks '$MinuteTask' and '$LogonTask' through a hidden launcher."
