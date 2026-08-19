$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$LogDir = Join-Path $ScriptDir "reports"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$Stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$LogPath = Join-Path $LogDir "inbox-briefing-run-$Stamp.txt"
$ReportPath = Join-Path $LogDir "inbox-briefing-$Stamp.md"

$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$PythonExe = if (Test-Path $VenvPython) { $VenvPython } else { "python" }

"Inbox Briefing run - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Tee-Object -FilePath $LogPath
"Command: $PythonExe inbox_briefing.py --self-email yungyeong.j@afstransco.com --output $ReportPath" | Tee-Object -FilePath $LogPath -Append
"" | Tee-Object -FilePath $LogPath -Append

try {
    & $PythonExe "inbox_briefing.py" "--self-email" "yungyeong.j@afstransco.com" "--output" $ReportPath 2>&1 | Tee-Object -FilePath $LogPath -Append
    $ExitCode = $LASTEXITCODE
    "" | Tee-Object -FilePath $LogPath -Append
    "Exit code: $ExitCode" | Tee-Object -FilePath $LogPath -Append
    exit $ExitCode
} catch {
    "" | Tee-Object -FilePath $LogPath -Append
    "ERROR: $($_.Exception.Message)" | Tee-Object -FilePath $LogPath -Append
    throw
}