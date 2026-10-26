param(
  [Parameter(Mandatory = $true)][string]$Image,
  [Parameter(Mandatory = $true)][string]$Spec
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding

function Format-Num($value) {
  return ([double]$value).ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function Escape-Json([string]$text) {
  if ($null -eq $text) { return "" }
  $escaped = $text.Replace("\", "\\").Replace('"', '\"')
  $escaped = $escaped.Replace("`r", "\r").Replace("`n", "\n").Replace("`t", "\t")
  return $escaped
}

function Write-Payload([string]$json) {
  [Console]::Out.WriteLine($json)
}

function Fail([int]$code, [string]$reason, [string]$detail) {
  $body = '{"ok":false,"reason":"' + (Escape-Json $reason) + '"'
  if ($detail) {
    $body += ',"detail":"' + (Escape-Json $detail) + '"'
  }
  Write-Payload ($body + "}")
  exit $code
}

function Error-Detail($record) {
  $message = ""
  if ($record.Exception -and $record.Exception.Message) {
    $message = [string]$record.Exception.Message
  } elseif ($record) {
    $message = [string]$record
  }
  $stack = ""
  if ($record.ScriptStackTrace) {
    $stack = [string]$record.ScriptStackTrace
  }
  if ($stack) { return $message + "`n" + $stack }
  return $message
}

function Pick-Language($spec, $supported) {
  $tags = @()
  if ($spec.tags) { $tags = @($spec.tags) }
  foreach ($tag in $tags) {
    foreach ($lang in $supported) {
      if ($lang.LanguageTag -eq [string]$tag) { return $lang }
    }
  }
  $prefix = ""
  if ($spec.prefix) { $prefix = [string]$spec.prefix }
  if (-not $prefix) { return $null }
  foreach ($lang in $supported) {
    $value = [string]$lang.LanguageTag
    if ($value -eq $prefix -or $value.StartsWith($prefix + "-")) { return $lang }
  }
  return $null
}

function Await-WinRt($winRtTask, $resultType) {
  $asTask = $script:AsTaskGeneric.MakeGenericMethod($resultType)
  $netTask = $asTask.Invoke($null, @($winRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

try {
  $specObj = $Spec | ConvertFrom-Json
} catch {
  Fail 1 "bad-args" (Error-Detail $_)
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]

  $script:AsTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
  }) | Select-Object -First 1
} catch {
  Fail 1 "recognize-failed" (Error-Detail $_)
}

if (-not $script:AsTaskGeneric) {
  Fail 1 "winrt-task" "AsTask was not found"
}

$chosen = $null
$engine = $null
try {
  $available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
  $chosen = Pick-Language $specObj $available
  if ($chosen -and [Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($chosen)) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($chosen)
  }
} catch {
  Fail 1 "recognize-failed" (Error-Detail $_)
}

$asked = ""
if ($specObj.tags) { $asked = (@($specObj.tags) -join ",") }
if (-not $chosen) { Fail 2 "unsupported-language" $asked }
if (-not $engine) { Fail 2 "unsupported-language" ([string]$chosen.LanguageTag) }

$file = $null
$stream = $null
try {
  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Image)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $bgra = [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8
  if ($bitmap.BitmapPixelFormat -ne $bgra) {
    $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert(
      $bitmap,
      $bgra,
      [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
    )
  }
  $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $width = Format-Num $bitmap.PixelWidth
  $height = Format-Num $bitmap.PixelHeight
  $lineJson = New-Object System.Collections.Generic.List[string]
  foreach ($line in $result.Lines) {
    $wordJson = New-Object System.Collections.Generic.List[string]
    foreach ($word in $line.Words) {
      $rect = $word.BoundingRect
      $wordJson.Add(
        '{"text":"' + (Escape-Json ([string]$word.Text)) +
        '","x":' + (Format-Num $rect.X) +
        ',"y":' + (Format-Num $rect.Y) +
        ',"w":' + (Format-Num $rect.Width) +
        ',"h":' + (Format-Num $rect.Height) + "}"
      )
    }
    $lineJson.Add('{"words":[' + ($wordJson -join ",") + "]}")
  }
  Write-Payload ('{"ok":true,"width":' + $width + ',"height":' + $height + ',"lines":[' + ($lineJson -join ",") + "]}")
} catch {
  Fail 1 "recognize-failed" (Error-Detail $_)
} finally {
  if ($stream) { $stream.Dispose() }
}
