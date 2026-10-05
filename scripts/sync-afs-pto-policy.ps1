param(
  [switch]$Watch,
  [switch]$Deploy
)

$source = 'C:\Users\nero_\OneDrive - afstrans.co\afstrans.co - AFS_2023\Admin\0. Admin Dashboard\1. PTO Policy\AFS PTO Policy.md'
$destination = Join-Path $PSScriptRoot '..\content\policies\afs\pto-attendance-policy.md'
$destination = [System.IO.Path]::GetFullPath($destination)
$logFile = Join-Path $PSScriptRoot 'afs-pto-policy-sync.log'

function Log-Message([string]$message) {
  $line = "$(Get-Date -Format s) $message"
  Add-Content -LiteralPath $logFile -Value $line
  Write-Host $line
}

function Sync-Policy {
  if (-not (Test-Path -LiteralPath $source)) {
    throw "AFS PTO source file not found: $source"
  }

  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  $destinationHash = if (Test-Path -LiteralPath $destination) {
    (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
  } else { '' }

  if ($sourceHash -eq $destinationHash) {
    return $false
  }

  Copy-Item -LiteralPath $source -Destination $destination -Force
  Log-Message 'Synced AFS PTO policy.'

  if ($Deploy) {
    git add -- content/policies/afs/pto-attendance-policy.md
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit -m "Sync AFS PTO policy"
      if ($LASTEXITCODE -ne 0) { throw 'Unable to commit the synced AFS PTO policy.' }
      git push origin main
      if ($LASTEXITCODE -ne 0) { throw 'Unable to push the synced AFS PTO policy.' }
      npx vercel deploy --prod
      if ($LASTEXITCODE -ne 0) { throw 'Unable to deploy the synced AFS PTO policy.' }
    }
  }

  return $true
}

Sync-Policy | Out-Null

if ($Watch) {
  Log-Message "Watching $source"
  $lastWrite = (Get-Item -LiteralPath $source).LastWriteTimeUtc
  while ($true) {
    Start-Sleep -Seconds 3
    if (-not (Test-Path -LiteralPath $source)) { Log-Message 'Source file is temporarily unavailable; retrying.'; continue }
    $currentWrite = (Get-Item -LiteralPath $source).LastWriteTimeUtc
    if ($currentWrite -ne $lastWrite) {
      $lastWrite = $currentWrite
      Start-Sleep -Seconds 2
      try { Sync-Policy | Out-Null } catch { Log-Message "Sync failed: $($_.Exception.Message)" }
    }
  }
}
