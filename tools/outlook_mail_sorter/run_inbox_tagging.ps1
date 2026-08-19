$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$LogDir = Join-Path $ScriptDir "reports"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$Stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$LogPath = Join-Path $LogDir "outlook-inbox-tagging-$Stamp.txt"

$VenvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$PythonExe = if (Test-Path $VenvPython) { $VenvPython } else { "python" }

Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTPS_PROXY -ErrorAction SilentlyContinue
$env:NO_PROXY = "localhost,127.0.0.1,::1,login.microsoftonline.com,graph.microsoft.com"

"Outlook Inbox Tagging report - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Tee-Object -FilePath $LogPath
"Command 1: $PythonExe outlook_mail_sorter.py classify --config config.json --token-cache .token_cache.json" | Tee-Object -FilePath $LogPath -Append
"Command 2: $PythonExe outlook_mail_sorter.py sort-inbox --config config.json --token-cache .token_cache.json" | Tee-Object -FilePath $LogPath -Append
"" | Tee-Object -FilePath $LogPath -Append

try {
    & $PythonExe "outlook_mail_sorter.py" "classify" "--config" "config.json" "--token-cache" ".token_cache.json" 2>&1 | Tee-Object -FilePath $LogPath -Append
    $ExitCode1 = $LASTEXITCODE
    "" | Tee-Object -FilePath $LogPath -Append
    & $PythonExe "outlook_mail_sorter.py" "sort-inbox" "--config" "config.json" "--token-cache" ".token_cache.json" 2>&1 | Tee-Object -FilePath $LogPath -Append
    $ExitCode2 = $LASTEXITCODE
    "" | Tee-Object -FilePath $LogPath -Append
    "Exit code classify: $ExitCode1" | Tee-Object -FilePath $LogPath -Append
    "Exit code sort-inbox: $ExitCode2" | Tee-Object -FilePath $LogPath -Append
    if ($ExitCode1 -ne 0) { exit $ExitCode1 }
    exit $ExitCode2
} catch {
    "" | Tee-Object -FilePath $LogPath -Append
    "ERROR: $($_.Exception.Message)" | Tee-Object -FilePath $LogPath -Append
    throw
}

