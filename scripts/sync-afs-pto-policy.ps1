param(
  [switch]$Watch,
  [switch]$Deploy
)

$source = 'C:\Users\nero_\OneDrive - afstrans.co\afstrans.co - AFS_2023\Admin\0. Admin Dashboard\1. PTO Policy\AFS PTO Policy.md'
$destination = Join-Path $PSScriptRoot '..\content\policies\afs\pto-attendance-policy.md'
$destination = [System.IO.Path]::GetFullPath($destination)

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
  Write-Host "Synced AFS PTO policy: $(Get-Date -Format s)"

  if ($Deploy) {
    git add -- content/policies/afs/pto-attendance-policy.md
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit -m "Sync AFS PTO policy"
      git push origin main
      npx vercel deploy --prod
    }
  }

  return $true
}

Sync-Policy | Out-Null

if ($Watch) {
  Write-Host "Watching $source"
  $lastWrite = (Get-Item -LiteralPath $source).LastWriteTimeUtc
  while ($true) {
    Start-Sleep -Seconds 3
    $currentWrite = (Get-Item -LiteralPath $source).LastWriteTimeUtc
    if ($currentWrite -ne $lastWrite) {
      $lastWrite = $currentWrite
      Start-Sleep -Seconds 2
      Sync-Policy | Out-Null
    }
  }
}
