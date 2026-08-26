param([string]$Destination = (Join-Path $PSScriptRoot '..\src-tauri\resources\qwen3-tts\models\qwen3-tts-0.6b-customvoice-q4_k_m'))
$ErrorActionPreference = 'Stop'
$files = @(
  @{ Name = 'qwen-talker-0.6b-customvoice-Q4_K_M.gguf'; Size = 604878080; Sha256 = 'b3a7e6613d80f8a703c06267fc1e94d48ce91932ab82ab6e31c50f4ca4868e1e' },
  @{ Name = 'qwen-tokenizer-12hz-Q4_K_M.gguf'; Size = 254974752; Sha256 = 'cf3788b4d50aaa665fb6e57c170396aae03a3555fea52d2b5d0cda902d658039' }
)
$baseUrl = 'https://huggingface.co/FindaDeath/Qwen3-TTS-GGUF/resolve/main'
$resolvedDestination = [IO.Path]::GetFullPath($Destination)
[IO.Directory]::CreateDirectory($resolvedDestination) | Out-Null
foreach ($file in $files) {
  $target = Join-Path $resolvedDestination $file.Name
  $valid = (Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -eq $file.Size)
  if ($valid) { $valid = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $file.Sha256 }
  if (-not $valid) {
    $temporary = "$target.download"
    Invoke-WebRequest -Uri "$baseUrl/$($file.Name)?download=true" -OutFile $temporary
    if ((Get-Item -LiteralPath $temporary).Length -ne $file.Size -or (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.Sha256) {
      Remove-Item -LiteralPath $temporary -Force
      throw "La verificacion de $($file.Name) fallo."
    }
    Move-Item -LiteralPath $temporary -Destination $target -Force
  }
}
Write-Host "Qwen3-TTS 0.6B instalado en $resolvedDestination"
