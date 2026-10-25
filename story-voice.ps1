param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
try {
  $request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $voices = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Speech\Voices\Tokens' | ForEach-Object {
    $attributes = Get-ItemProperty -LiteralPath ($_.PSPath + '\Attributes')
    $language = [Convert]::ToInt32(($attributes.Language -split ';')[0],16)
    @{id=$_.PSChildName; name=$attributes.Name; language=[Globalization.CultureInfo]::GetCultureInfo($language).Name}
  })
  if ($request.action -eq 'voices') {
    @{voices=$voices; engine='Windows SAPI (offline)'} | ConvertTo-Json -Depth 8 -Compress
    exit 0
  }
  if (-not ($voices | Where-Object {$_.id -ceq $request.voice})) {throw 'Selected Windows voice is not installed.'}
  $token = New-Object -ComObject SAPI.SpObjectToken
  $token.SetId('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Voices\Tokens\' + $request.voice)
  $speaker = New-Object -ComObject SAPI.SpVoice
  $speaker.Voice = $token
  $speaker.Rate = [int]$request.rate
  $index = 0
  foreach ($chunk in $request.chunks) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    try {
      $stream.Format.Type = 22
      $stream.Open((Join-Path $request.outputDir ('part-' + $index + '.wav')),3)
      $speaker.AudioOutputStream = $stream
      [void]$speaker.Speak([string]$chunk.text,16)
    } finally {$stream.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)}
    $index++
  }
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($speaker)
  @{parts=$index; engine='Windows SAPI (offline)'} | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
