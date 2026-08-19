$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$LogDir = Join-Path $ScriptDir "reports"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$Stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$LogPath = Join-Path $LogDir "outlook-mail-sorter-$Stamp.txt"

$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$PythonExe = if (Test-Path $VenvPython) { $VenvPython } else { "python" }

"Outlook Mail Sorter report - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Tee-Object -FilePath $LogPath
"Command: $PythonExe outlook_mail_sorter.py all" | Tee-Object -FilePath $LogPath -Append
"" | Tee-Object -FilePath $LogPath -Append

try {
    & $PythonExe "outlook_mail_sorter.py" "all" 2>&1 | Tee-Object -FilePath $LogPath -Append
    $ExitCode = $LASTEXITCODE
    "" | Tee-Object -FilePath $LogPath -Append
    "Exit code: $ExitCode" | Tee-Object -FilePath $LogPath -Append
    exit $ExitCode
} catch {
    "" | Tee-Object -FilePath $LogPath -Append
    "ERROR: $($_.Exception.Message)" | Tee-Object -FilePath $LogPath -Append
    throw
}