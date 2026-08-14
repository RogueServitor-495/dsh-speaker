# speech.ps1 - Windows SAPI speech helper invoked by the dsh-tts plugin.
# Do NOT run directly; index.js calls it via powershell.exe -File.
param(
  [string]$TextFile = "",
  [string]$Voice    = "",
  [int]$Rate        = 0,
  [int]$Volume      = 100,
  [switch]$List
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Create the SAPI voice engine (ProgID: SAPI.SpVoice).
$speaker = New-Object -ComObject SAPI.SpVoice

# ---- List available voices and exit. ----
if ($List) {
  foreach ($token in $speaker.GetVoices()) {
    $desc = $token.GetDescription()
    $id   = $token.Id
    Write-Output ($desc + [char]9 + $id)
  }
  exit 0
}

# ---- Read the text to speak (explicit UTF-8). ----
if ([string]::IsNullOrWhiteSpace($TextFile)) {
  throw "Missing TextFile parameter."
}
if (-not (Test-Path -LiteralPath $TextFile)) {
  throw "Text file not found: $TextFile"
}
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
if ([string]::IsNullOrWhiteSpace($text)) {
  throw "Text to speak is empty."
}

# ---- Clamp rate and volume. ----
if ($Rate -lt -10) { $Rate = -10 }
if ($Rate -gt 10)  { $Rate = 10 }
if ($Volume -lt 0)   { $Volume = 0 }
if ($Volume -gt 100) { $Volume = 100 }
$speaker.Rate   = $Rate
$speaker.Volume = $Volume

# ---- Select voice by fuzzy match on description or token id (case-insensitive). ----
if ($Voice -ne "") {
  $found = $null
  foreach ($token in $speaker.GetVoices()) {
    $desc = $token.GetDescription()
    $id   = $token.Id
    if ($desc -like "*$Voice*" -or $id -like "*$Voice*") {
      $found = $token
      break
    }
  }
  if ($null -eq $found) {
    throw "Voice not found: $Voice. Use the tts_voices tool to list available voices."
  }
  $speaker.Voice = $found
}

# ---- Speak synchronously (blocks until playback finishes), then report the voice used. ----
$speaker.Speak($text)
$usedDesc = $speaker.Voice.GetDescription()
Write-Output ("OK|" + $usedDesc)
