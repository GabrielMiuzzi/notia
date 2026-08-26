param(
  [ValidateSet('0.6b', '1.7b', 'all')]
  [string]$Model = '0.6b',
  [string]$Destination = (Join-Path $PSScriptRoot '..\src-tauri\resources\speech\models')
)

$profiles = @{
  '0.6b' = @{ Repo = 'Qwen3-ASR-0.6B-GGUF'; Directory = 'qwen3-asr-0.6b-q8'; Files = @{ 'Qwen3-ASR-0.6B-Q8_0.gguf' = 804749248; 'mmproj-Qwen3-ASR-0.6B-Q8_0.gguf' = 214392480 } }
  '1.7b' = @{ Repo = 'Qwen3-ASR-1.7B-GGUF'; Directory = 'qwen3-asr-1.7b-q8'; Files = @{ 'Qwen3-ASR-1.7B-Q8_0.gguf' = 2165034944; 'mmproj-Qwen3-ASR-1.7B-Q8_0.gguf' = 355709344 } }
}
$selected = if ($Model -eq 'all') { @('0.6b', '1.7b') } else { @($Model) }
foreach ($name in $selected) {
  $profile = $profiles[$name]
  $target = Join-Path $Destination $profile.Directory
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  foreach ($file in $profile.Files.Keys) {
    $output = Join-Path $target $file
    if ((Test-Path -LiteralPath $output) -and (Get-Item -LiteralPath $output).Length -eq $profile.Files[$file]) {
      Write-Host "$file ya está instalado."
      continue
    }
    $uri = "https://huggingface.co/ggml-org/$($profile.Repo)/resolve/main/$file"
    Write-Host "Descargando $file..."
    Invoke-WebRequest -Uri $uri -OutFile $output -ErrorAction Stop
  }
}
Write-Host 'Modelos Qwen3-ASR instalados.'
