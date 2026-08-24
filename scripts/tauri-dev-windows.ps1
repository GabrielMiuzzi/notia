$ErrorActionPreference = 'Stop'

$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$devConfigPath = Join-Path $repoPath 'src-tauri\tauri.windows.dev.conf.json'
$viteProcess = $null

function Test-NotiaDevPort {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $connect = $client.ConnectAsync('127.0.0.1', 1420)
    if (-not $connect.Wait(250)) {
      $client.Dispose()
      return $false
    }
    $connected = $client.Connected
    $client.Dispose()
    return $connected
  } catch {
    return $false
  }
}

function Get-DevPortOwner {
  $connection = Get-NetTCPConnection `
    -LocalPort 1420 `
    -State Listen `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($null -eq $connection) {
    return $null
  }

  return Get-CimInstance `
    -ClassName Win32_Process `
    -Filter "ProcessId = $($connection.OwningProcess)" `
    -ErrorAction SilentlyContinue
}

function Test-IsCurrentRepoViteProcess($ProcessInfo) {
  if ($null -eq $ProcessInfo -or [string]::IsNullOrWhiteSpace($ProcessInfo.CommandLine)) {
    return $false
  }

  $normalizedRepoPath = $repoPath.TrimEnd('\').ToLowerInvariant()
  $normalizedCommandLine = $ProcessInfo.CommandLine.Replace('/', '\').ToLowerInvariant()
  $vitePathPrefix = "$normalizedRepoPath\node_modules\"

  return $normalizedCommandLine.Contains($vitePathPrefix) `
    -and $normalizedCommandLine.Contains('\vite\bin\vite.js')
}

function Stop-ProcessTree([int]$RootProcessId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $RootProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -RootProcessId $child.ProcessId
  }
  Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

if (Test-NotiaDevPort) {
  $portOwner = Get-DevPortOwner
  if (Test-IsCurrentRepoViteProcess $portOwner) {
    Write-Host "Reutilizando Vite de este repositorio en http://127.0.0.1:1420 (PID $($portOwner.ProcessId))."
  } else {
    $ownerDescription = if ($null -ne $portOwner) {
      "$($portOwner.Name), PID $($portOwner.ProcessId)"
    } else {
      'proceso desconocido'
    }
    Write-Error "El puerto 1420 esta ocupado por $ownerDescription. Cerra ese proceso o libera el puerto y volve a intentar."
  }
}

try {
  if (-not (Test-NotiaDevPort)) {
    Write-Host 'Iniciando Vite en http://127.0.0.1:1420...'
    $viteProcess = Start-Process `
      -FilePath 'npm.cmd' `
      -ArgumentList @('run', 'dev') `
      -WorkingDirectory $repoPath `
      -WindowStyle Hidden `
      -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-NotiaDevPort)) {
      if ($viteProcess.HasExited) {
        throw "Vite termino antes de abrir el puerto 1420 (exit code $($viteProcess.ExitCode)). Ejecuta 'npm run dev' para ver el detalle."
      }
      if ([DateTime]::UtcNow -ge $deadline) {
        throw 'Vite no abrio el puerto 1420 dentro de 20 segundos.'
      }
      Start-Sleep -Milliseconds 200
      $viteProcess.Refresh()
    }
  }

  Write-Host 'Vite listo. Iniciando Tauri...'
  & npx.cmd @tauri-apps/cli dev --config $devConfigPath
  exit $LASTEXITCODE
} finally {
  if ($null -ne $viteProcess -and -not $viteProcess.HasExited) {
    Stop-ProcessTree -RootProcessId $viteProcess.Id
  }
}
