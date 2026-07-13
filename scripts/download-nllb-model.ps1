param(
  [string]$Destination = ".cache/nllb-200_600M_int8_ct2.zip",
  [string]$InstallRoot = ".cache/nllb",
  [string]$ExpectedSha256 = "A1DEDE18A91665B4670FD1E18942317226F3A3A8A1F96FCA7099551F065CE224",
  [int]$Concurrency = 16,
  [int64]$ChunkBytes = 4MB
)

$ErrorActionPreference = "Stop"
$url = "https://pretrained-nmt-models.s3.us-west-004.backblazeb2.com/CTranslate2/nllb/nllb-200_600M_int8_ct2.zip"
$totalBytes = 578586670L
$destinationPath = [System.IO.Path]::GetFullPath((Join-Path $PWD $Destination))
$cachePath = Split-Path -Parent $destinationPath
$partCount = [int][Math]::Ceiling($totalBytes / $ChunkBytes)

New-Item -ItemType Directory -Path $cachePath -Force | Out-Null

if (-not (Test-Path -LiteralPath $destinationPath) -or (Get-Item -LiteralPath $destinationPath).Length -ne $totalBytes) {
for ($batchStart = 0; $batchStart -lt $partCount; $batchStart += $Concurrency) {
  $batchEnd = [Math]::Min($batchStart + $Concurrency, $partCount)
  $pending = @()

  foreach ($index in $batchStart..($batchEnd - 1)) {
    $start = [int64]($index * $ChunkBytes)
    $end = [Math]::Min([int64](($index + 1) * $ChunkBytes - 1), $totalBytes - 1)
    $partPath = Join-Path $cachePath ("nllb-part-{0:D3}.bin" -f $index)
    $expectedBytes = $end - $start + 1
    if (-not (Test-Path -LiteralPath $partPath) -or (Get-Item -LiteralPath $partPath).Length -ne $expectedBytes) {
      $pending += $index
    }
  }

  for ($attempt = 1; $attempt -le 6 -and $pending.Count -gt 0; $attempt++) {
    $downloads = foreach ($index in $pending) {
      $start = [int64]($index * $ChunkBytes)
      $end = [Math]::Min([int64](($index + 1) * $ChunkBytes - 1), $totalBytes - 1)
      $partPath = Join-Path $cachePath ("nllb-part-{0:D3}.bin" -f $index)
      Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue
      $arguments = @(
        "-L", "--fail", "--silent", "--show-error", "--retry", "2", "--retry-delay", "1",
        "--connect-timeout", "20", "--max-time", "180",
        "--range", "$start-$end", "--output", $partPath, $url
      )
      [pscustomobject]@{
        Index = $index
        ExpectedBytes = $end - $start + 1
        Path = $partPath
        Process = Start-Process -FilePath "curl.exe" -ArgumentList $arguments -PassThru -WindowStyle Hidden
      }
    }

    $downloads.Process | Wait-Process
    $pending = @(
      $downloads |
        Where-Object { -not (Test-Path -LiteralPath $_.Path) -or (Get-Item -LiteralPath $_.Path).Length -ne $_.ExpectedBytes } |
        ForEach-Object { $_.Index }
    )
  }

  if ($pending.Count -gt 0) {
    throw "NLLB chunks failed after retries: $($pending -join ', ')"
  }

  $completed = [Math]::Min($batchEnd * $ChunkBytes, $totalBytes)
  Write-Host ("Downloaded {0:N1}%" -f (100 * $completed / $totalBytes))
}

$output = [System.IO.File]::Create($destinationPath)
try {
  for ($index = 0; $index -lt $partCount; $index++) {
    $partPath = Join-Path $cachePath ("nllb-part-{0:D3}.bin" -f $index)
    $input = [System.IO.File]::OpenRead($partPath)
    try {
      $input.CopyTo($output)
    } finally {
      $input.Dispose()
    }
  }
} finally {
  $output.Dispose()
}

if ((Get-Item -LiteralPath $destinationPath).Length -ne $totalBytes) {
  throw "NLLB archive size does not match the expected $totalBytes bytes."
}
}

Get-ChildItem -LiteralPath $cachePath -Filter "nllb-part-*.bin" | Remove-Item -Force
$archiveHash = Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256
if ($ExpectedSha256 -and $archiveHash.Hash -ne $ExpectedSha256.ToUpperInvariant()) {
  throw "NLLB archive checksum mismatch: $($archiveHash.Hash)"
}
Write-Host "Archive SHA256: $($archiveHash.Hash)"

$installRootPath = [System.IO.Path]::GetFullPath((Join-Path $PWD $InstallRoot))
$extractPath = Join-Path $cachePath "nllb-extracted"
Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $destinationPath -DestinationPath $extractPath -Force
$modelBins = @(Get-ChildItem -LiteralPath $extractPath -Filter "model.bin" -File -Recurse)
if ($modelBins.Count -ne 1) {
  throw "Expected one model.bin in the NLLB archive, found $($modelBins.Count)."
}

$modelPath = Join-Path $installRootPath "model"
Remove-Item -LiteralPath $modelPath -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $installRootPath -Force | Out-Null
Copy-Item -LiteralPath $modelBins[0].Directory.FullName -Destination $modelPath -Recurse

$sentencePiecePath = Join-Path $installRootPath "sentencepiece.bpe.model"
if (-not (Test-Path -LiteralPath $sentencePiecePath)) {
  $sentencePieceUrl = "https://pretrained-nmt-models.s3.us-west-004.backblazeb2.com/CTranslate2/nllb/flores200_sacrebleu_tokenizer_spm.model"
  & curl.exe -L --fail --retry 4 --retry-delay 2 --output $sentencePiecePath $sentencePieceUrl
  if ($LASTEXITCODE -ne 0) {
    throw "NLLB SentencePiece download failed with exit code $LASTEXITCODE."
  }
}

Remove-Item -LiteralPath $extractPath -Recurse -Force
Write-Host "NLLB model installed at $modelPath"
$archiveHash
