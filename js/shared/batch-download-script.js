// The fixed files that go into a Batch Download bundle (js/tools/batch-download.js).
//
// THIS FILE IS THE ONLY COPY of download-files.ps1, Run Download.cmd and
// README.txt. There is deliberately no .ps1 in the repo that could drift.
//
// Core rule: these texts are constants. Never build them from user data and
// never add template substitution. User data reaches the user's machine only
// through files.csv, which the script reads as data.
//
// Format rules (checked by tests/script-hash.html):
//   - ASCII only: Windows PowerShell 5.1 misreads UTF-8 files without a BOM.
//   - No backticks and no "${" anywhere: these are JS template literals.
//     (PowerShell's backtick escapes are avoided on purpose.)
//   - Line endings are converted to CRLF when zipped (see bundleFiles()).
//
// CHECKLIST when SCRIPT_PS1 changes:
//   1. Open tests/script-hash.html (served or from disk) and confirm it passes.
//   2. Copy the SHA-256 it shows into README.md ("Script fingerprint").
//   3. Re-run the hostile-CSV check described in tests/fixtures/README.md.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  const SCRIPT_PS1 = String.raw`# download-files.ps1
# Batch Download script from AI Utilities (Document Tools > Batch Download).
#
# What it does:
#   Reads files.csv (columns URL, Filename, Extension) from this folder and
#   downloads each row into the "Downloaded Files" folder under the approved
#   name. Every row gets an [OK], [SKIPPED] or [FAILED] line, and all results
#   are written to download-log.csv.
#
# Safety rules (the web page checks these too, but files.csv may have been
# edited by hand, so nothing in it is trusted):
#   - Only http and https links are downloaded (no file://, network paths, ftp).
#   - Only the allowed file types below are saved.
#   - Files are only ever written inside "Downloaded Files".
#   - Existing files are never overwritten; a " (2)" style suffix is added.
#   - Downloads go to a temporary file first, so failures leave nothing behind.
#   - Nothing that is downloaded is ever opened or run. Saved files are marked
#     as downloaded from the internet, as a browser would do.
#   - No registry, profile or system changes, and no administrator rights.

$ErrorActionPreference = 'Stop'

$AllowedTypes = @('pdf','doc','docx','rtf','odt','txt','md','csv','xls','xlsx','ods',
                  'ppt','pptx','odp','jpg','jpeg','png','gif','tif','tiff','webp',
                  'mp3','mp4','m4a','wav','zip')
$ReservedNames = @('CON','PRN','AUX','NUL',
                   'COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9',
                   'LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9')
$MaxPathLength = 250
$MaxNameLength = 150

$Here       = $PSScriptRoot
$CsvPath    = Join-Path $Here 'files.csv'
$OutDir     = Join-Path $Here 'Downloaded Files'
$LogPath    = Join-Path $Here 'download-log.csv'

function Write-Line([string]$Tag, [string]$Name, [string]$Note, [string]$Color) {
    Write-Host ('{0,-10}' -f $Tag) -ForegroundColor $Color -NoNewline
    Write-Host $Name
    if ($Note) { Write-Host ('          ' + $Note) -ForegroundColor DarkGray }
}

function Stop-Script([string]$Message) {
    Write-Host ''
    Write-Host $Message -ForegroundColor Red
    exit 1
}

# Same cleanup as the web page: slashes become hyphens, characters Windows
# doesn't allow become spaces, trailing dots and spaces are removed.
function Get-CleanName([string]$Name) {
    if ($null -eq $Name) { return '' }
    $n = $Name -replace '[\\/]', '-'
    $n = $n -replace '[:*?"<>|\x00-\x1F\x7F]', ' '
    $n = ($n -replace '\s+', ' ').Trim()
    $n = $n -replace '[. ]+$', ''
    return $n
}

function Test-ReservedName([string]$Name) {
    $stem = $Name.Split('.')[0].Trim().ToUpperInvariant()
    return ($ReservedNames -contains $stem)
}

# True only if Path resolves to a file directly inside the output folder.
function Test-InsideOutDir([string]$Path) {
    try { $full = [IO.Path]::GetFullPath($Path) } catch { return $false }
    if (-not $full.StartsWith($script:OutFull, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    return ($full.Substring($script:OutFull.Length).IndexOfAny([char[]]@('\', '/')) -lt 0)
}

# First path that doesn't exist yet: "Name.pdf", "Name (2).pdf", ...
function Get-FreePath([string]$Base, [string]$Ext) {
    $candidate = [IO.Path]::Combine($script:OutFull, ($Base + '.' + $Ext))
    $i = 2
    while (Test-Path -LiteralPath $candidate) {
        $candidate = [IO.Path]::Combine($script:OutFull, ('{0} ({1}).{2}' -f $Base, $i, $Ext))
        $i++
    }
    return $candidate
}

function Get-FileHead([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $buffer = New-Object byte[] 512
        $count = $stream.Read($buffer, 0, 512)
        if ($count -lt 512) { [Array]::Resize([ref]$buffer, $count) }
        return ,$buffer
    } finally {
        $stream.Dispose()
    }
}

function Test-Bytes([byte[]]$Head, [int]$Offset, [byte[]]$Expected) {
    if ($Head.Length -lt $Offset + $Expected.Length) { return $false }
    for ($i = 0; $i -lt $Expected.Length; $i++) {
        if ($Head[$Offset + $i] -ne $Expected[$i]) { return $false }
    }
    return $true
}

function Test-LooksLikeWebPage([byte[]]$Head) {
    $text = [Text.Encoding]::ASCII.GetString($Head).TrimStart([char]0xFEFF, [char]0xEF, [char]0xBB, [char]0xBF, ' ', [char]9, [char]10, [char]13, '?')
    return ($text -match '^(?i)<(!doctype\s+html|html|head|body)[\s>]')
}

# Works out a file type from its first bytes, then from the server's
# Content-Type. Returns '' when it can't tell.
function Get-DetectedType([byte[]]$Head, [string]$ContentType) {
    $ct = ''
    if ($ContentType) { $ct = $ContentType.Split(';')[0].Trim().ToLowerInvariant() }
    if (Test-Bytes $Head 0 ([byte[]](0x25,0x50,0x44,0x46))) { return 'pdf' }
    if (Test-Bytes $Head 0 ([byte[]](0x50,0x4B,0x03,0x04))) {
        if ($ct -match 'wordprocessingml') { return 'docx' }
        if ($ct -match 'spreadsheetml') { return 'xlsx' }
        if ($ct -match 'presentationml') { return 'pptx' }
        if ($ct -match 'opendocument\.text') { return 'odt' }
        if ($ct -match 'opendocument\.spreadsheet') { return 'ods' }
        if ($ct -match 'opendocument\.presentation') { return 'odp' }
        return 'zip'
    }
    if (Test-Bytes $Head 0 ([byte[]](0xD0,0xCF,0x11,0xE0))) {
        if ($ct -match 'msword') { return 'doc' }
        if ($ct -match 'ms-excel') { return 'xls' }
        if ($ct -match 'ms-powerpoint') { return 'ppt' }
        return ''
    }
    if (Test-Bytes $Head 0 ([byte[]](0x7B,0x5C,0x72,0x74,0x66))) { return 'rtf' }
    if (Test-Bytes $Head 0 ([byte[]](0xFF,0xD8,0xFF))) { return 'jpg' }
    if (Test-Bytes $Head 0 ([byte[]](0x89,0x50,0x4E,0x47))) { return 'png' }
    if (Test-Bytes $Head 0 ([byte[]](0x47,0x49,0x46,0x38))) { return 'gif' }
    if ((Test-Bytes $Head 0 ([byte[]](0x49,0x49,0x2A,0x00))) -or (Test-Bytes $Head 0 ([byte[]](0x4D,0x4D,0x00,0x2A)))) { return 'tif' }
    if (Test-Bytes $Head 0 ([byte[]](0x52,0x49,0x46,0x46))) {
        if (Test-Bytes $Head 8 ([byte[]](0x57,0x45,0x42,0x50))) { return 'webp' }
        if (Test-Bytes $Head 8 ([byte[]](0x57,0x41,0x56,0x45))) { return 'wav' }
    }
    if ((Test-Bytes $Head 0 ([byte[]](0x49,0x44,0x33))) -or ($Head.Length -ge 2 -and $Head[0] -eq 0xFF -and ($Head[1] -band 0xF6) -eq 0xF2)) { return 'mp3' }
    if (Test-Bytes $Head 4 ([byte[]](0x66,0x74,0x79,0x70))) {
        if ($ct -like 'audio/*') { return 'm4a' }
        return 'mp4'
    }
    switch ($ct) {
        'application/pdf' { return 'pdf' }
        'text/plain' { return 'txt' }
        'text/csv' { return 'csv' }
        'text/markdown' { return 'md' }
        'application/rtf' { return 'rtf' }
        'text/rtf' { return 'rtf' }
    }
    return ''
}

# Plain-language reason for a download error.
function Get-FailureReason($ErrorRecord, [string]$HostName) {
    $ex = $ErrorRecord.Exception
    while ($ex -and -not ($ex -is [Net.WebException]) -and $ex.InnerException) { $ex = $ex.InnerException }
    if ($ex -is [Net.WebException]) {
        $status = [string]$ex.Status
        if ($status -eq 'ProtocolError' -and $ex.Response) {
            $code = [int]$ex.Response.StatusCode
            if ($code -eq 401 -or $code -eq 403) { return 'Failed: the site refused access (login or permission required). Download this one manually in your browser.' }
            if ($code -eq 404 -or $code -eq 410) { return ('Failed: the file was not found at that address ({0}). The link may be outdated.' -f $code) }
            if ($code -eq 429 -or $code -ge 500) { return ('Failed: the site is busy or had an error ({0}). Try again later.' -f $code) }
            return ('Failed: the site answered with an error ({0}).' -f $code)
        }
        if ($status -eq 'Timeout') { return 'Failed: the site took too long to respond.' }
        if ($status -match 'NameResolutionFailure|ConnectFailure|ConnectionClosed|KeepAliveFailure|ReceiveFailure|SendFailure') {
            return ('Failed: could not reach {0}. Check your internet connection or VPN.' -f $HostName)
        }
        if ($status -match 'TrustFailure|SecureChannelFailure') { return ('Failed: could not make a secure connection to {0}.' -f $HostName) }
        return ('Failed: the download did not complete ({0}).' -f $status)
    }
    $base = $ErrorRecord.Exception.GetBaseException()
    if ($base -is [UnauthorizedAccessException] -or $base -is [IO.IOException]) {
        return ('Failed: could not save the file ({0}). Close any program using it, or check that OneDrive or antivirus is not blocking the folder.' -f $ErrorRecord.Exception.GetBaseException().Message)
    }
    return ('Something unexpected went wrong: {0} The details are in download-log.csv.' -f $ErrorRecord.Exception.GetBaseException().Message)
}

# Log values that a spreadsheet would treat as a formula get a leading quote.
function Protect-Cell([string]$Value) {
    if ($Value -match '^[=+\-@]') { return "'" + $Value }
    return $Value
}

# ---------------------------------------------------------------------------

Write-Host 'Batch Download'
Write-Host '--------------'

if (-not (Test-Path -LiteralPath $CsvPath -PathType Leaf)) {
    Stop-Script 'Cannot find files.csv next to this script. Unzip the whole bundle into one folder and run again.'
}

try {
    $rows = @(Import-Csv -LiteralPath $CsvPath -Encoding UTF8)
} catch {
    Stop-Script ('files.csv could not be read ({0}). Re-export it from the Batch Download page.' -f $_.Exception.GetBaseException().Message)
}
$columns = @()
if ($rows.Count -gt 0) { $columns = @($rows[0].PSObject.Properties | ForEach-Object { $_.Name }) }
if ($rows.Count -eq 0 -or -not ($columns -contains 'URL' -and $columns -contains 'Filename' -and $columns -contains 'Extension')) {
    Stop-Script 'files.csv is not in the expected format (URL, Filename, Extension). Re-export it from the Batch Download page.'
}

try {
    [IO.Directory]::CreateDirectory($OutDir) | Out-Null
    $script:OutFull = [IO.Path]::GetFullPath($OutDir).TrimEnd('\') + '\'
    $probe = [IO.Path]::Combine($script:OutFull, ('.write-test-' + [Guid]::NewGuid().ToString('N')))
    [IO.File]::WriteAllText($probe, '')
    Remove-Item -LiteralPath $probe -Force
} catch {
    Stop-Script ("Could not create or write to the 'Downloaded Files' folder here ({0}). Move the bundle to a folder you can write to (for example Documents) and run again." -f $_.Exception.GetBaseException().Message)
}

# TLS 1.2 in addition to whatever Windows already allows.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

Write-Host ('{0} file(s) to download into: {1}' -f $rows.Count, $OutDir)
Write-Host ''

$log = New-Object System.Collections.Generic.List[object]
$saved = 0; $skipped = 0; $failed = 0; $refused = 0
$rowNumber = 0

foreach ($row in $rows) {
    $rowNumber++
    $url = ([string]$row.URL).Trim()
    $rawName = [string]$row.Filename
    $ext = ([string]$row.Extension).Trim().TrimStart('.').ToLowerInvariant()
    $name = Get-CleanName $rawName
    $label = $name
    if (-not $label) { $label = ('(row {0}) {1}' -f $rowNumber, $rawName.Trim()) }
    $status = ''; $reason = ''; $detail = ''; $savedAs = ''
    $temp = $null; $uri = $null; $contentType = ''

    try {
        $validUri = [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$uri)
        if (-not $validUri -or $uri.IsUnc -or ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https')) {
            $status = 'SKIPPED'; $reason = 'Skipped: only web links (http/https) are allowed.'
        } elseif (-not $name -or (Test-ReservedName $name)) {
            $status = 'SKIPPED'; $reason = 'Skipped: the filename is not allowed by Windows. Fix it on the Batch Download page and re-export.'
        } elseif ($ext -ne 'auto' -and -not ($ext -match '^[a-z0-9]{1,10}$' -and $AllowedTypes -contains $ext)) {
            $status = 'SKIPPED'; $reason = ('Skipped: .{0} files are not allowed.' -f $ext)
        } elseif (($name.Length + $ext.Length + 1) -gt $MaxNameLength) {
            $status = 'SKIPPED'; $reason = ('Skipped: the filename is longer than {0} characters. Shorten it on the Batch Download page and re-export.' -f $MaxNameLength)
        } else {
            $planned = [IO.Path]::Combine($script:OutFull, ($name + '.' + $ext))
            if (-not (Test-InsideOutDir $planned)) {
                $status = 'SKIPPED'; $reason = "Skipped: the filename tries to save outside the 'Downloaded Files' folder."
            } elseif ($planned.Length -gt $MaxPathLength) {
                $status = 'SKIPPED'; $reason = 'Skipped: the full path is too long for Windows. Move the bundle to a shorter folder path (for example C:\Downloads) or shorten the name.'
            }
        }

        if (-not $status) {
            $temp = [IO.Path]::Combine($script:OutFull, ('.download-' + [Guid]::NewGuid().ToString('N') + '.part'))
            $client = New-Object System.Net.WebClient
            $client.Headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AI-Utilities-BatchDownload/1.0'
            try {
                $client.DownloadFile($uri, $temp)
                $contentType = [string]$client.ResponseHeaders['Content-Type']
            } finally {
                $client.Dispose()
            }

            $head = Get-FileHead $temp
            $finalExt = $ext
            if ($head.Length -eq 0) {
                $status = 'FAILED'; $reason = 'Failed: the site sent an empty file.'
            } elseif (Test-LooksLikeWebPage $head) {
                $status = 'FAILED'; $reason = 'Failed: the site sent a web page instead of the file (often a login or error page). Open the link in your browser to check.'
                $detail = ('Content-Type: {0}' -f $contentType)
            } elseif ($ext -eq 'auto') {
                $finalExt = Get-DetectedType $head $contentType
                if (-not $finalExt) {
                    $status = 'FAILED'; $reason = 'Failed: the downloaded file is a type that is not allowed, or its type could not be worked out. It was deleted.'
                    $detail = ('Content-Type: {0}' -f $contentType)
                } elseif (-not ($AllowedTypes -contains $finalExt)) {
                    $status = 'FAILED'; $reason = ('Failed: the downloaded file is a type that is not allowed ({0}). It was deleted.' -f $finalExt)
                }
            }

            if (-not $status) {
                $target = Get-FreePath $name $finalExt
                if (-not (Test-InsideOutDir $target)) {
                    $status = 'SKIPPED'; $reason = "Skipped: the filename tries to save outside the 'Downloaded Files' folder."
                } elseif ($target.Length -gt $MaxPathLength) {
                    $status = 'SKIPPED'; $reason = 'Skipped: the full path is too long for Windows. Move the bundle to a shorter folder path (for example C:\Downloads) or shorten the name.'
                } else {
                    [IO.File]::Move($temp, $target)
                    $temp = $null
                    try {
                        Set-Content -LiteralPath $target -Stream 'Zone.Identifier' -Value @('[ZoneTransfer]', 'ZoneId=3', ('HostUrl=' + $uri.AbsoluteUri))
                    } catch {
                        $detail = 'Could not mark the file as downloaded from the internet.'
                    }
                    $status = 'OK'
                    $savedAs = [IO.Path]::GetFileName($target)
                    $wanted = $name + '.' + $finalExt
                    if ($savedAs -ne $wanted) {
                        if ($ext -eq 'auto' -and -not (Test-Path -LiteralPath ([IO.Path]::Combine($script:OutFull, $wanted)))) {
                            $reason = ('Saved as {0} (file type detected after downloading).' -f $savedAs)
                        } else {
                            $reason = ("Saved as '{0}' because '{1}' already exists." -f $savedAs, $wanted)
                        }
                    } elseif ($ext -eq 'auto') {
                        $reason = ('Saved as {0} (file type detected after downloading).' -f $savedAs)
                    }
                }
            }
        }
    } catch {
        $status = 'FAILED'
        $reason = Get-FailureReason $_ $uri.Host
        $detail = $_.Exception.GetBaseException().Message
        if ($reason -match 'refused access') { $refused++ }
    } finally {
        if ($temp -and (Test-Path -LiteralPath $temp)) {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        }
    }

    switch ($status) {
        'OK'      { $saved++;   Write-Line '[OK]' $savedAs $reason 'Green' }
        'SKIPPED' { $skipped++; Write-Line '[SKIPPED]' $label $reason 'Yellow' }
        default   { $failed++;  Write-Line '[FAILED]' $label $reason 'Red' }
    }
    $log.Add([pscustomobject][ordered]@{
        Row     = $rowNumber
        URL     = Protect-Cell $url
        SavedAs = Protect-Cell $savedAs
        Status  = $status
        Reason  = $reason
        Detail  = Protect-Cell $detail
    })
}

Write-Host ''
Write-Host ('Done. Saved: {0}   Skipped: {1}   Failed: {2}' -f $saved, $skipped, $failed)

try {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $log | Export-Csv -LiteralPath $LogPath -NoTypeInformation -Encoding utf8BOM
    } else {
        $log | Export-Csv -LiteralPath $LogPath -NoTypeInformation -Encoding UTF8
    }
    Write-Host ('Details for every row: {0}' -f $LogPath)
} catch {
    Write-Host ('Could not write download-log.csv ({0}).' -f $_.Exception.GetBaseException().Message) -ForegroundColor Yellow
}

if ($saved -eq 0 -and $failed -gt 0) {
    Write-Host ''
    Write-Host 'Nothing was downloaded. The most common causes are no internet connection, a VPN or proxy, or links that need a login.' -ForegroundColor Yellow
} elseif ($refused -gt 0) {
    Write-Host ''
    Write-Host ('{0} file(s) need a login or permission. Open those links in your browser to download them.' -f $refused) -ForegroundColor Yellow
}
if ($skipped -gt 0) {
    Write-Host 'Skipped rows can be fixed on the Batch Download page; export the bundle again afterwards.' -ForegroundColor Yellow
}

if ($saved -gt 0) {
    Invoke-Item -LiteralPath $OutDir
}
`;

  const RUNNER_CMD = String.raw`@echo off
rem Runs download-files.ps1 from this folder. Windows may show an
rem "Open File - Security Warning" first; see README.txt.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-files.ps1"
pause
`;

  const README_TXT = String.raw`BATCH DOWNLOAD BUNDLE
=====================

Made by AI Utilities (Document Tools > Batch Download):
https://github.com/nickhafen/nh-ai-utilities

This folder contains:
  files.csv           The list of files to download: URL, Filename, Extension.
                      This is the only part made from your document.
  download-files.ps1  The PowerShell script that does the downloading. It is
                      the same for every bundle.
  Run Download.cmd    Double-click this to run the script.
  README.txt          This file.

WINDOWS ONLY. The script needs Windows PowerShell 5.1 or later, which is built
into Windows 10 and 11.


HOW TO RUN
----------
1. Unzip the whole bundle into one folder (right-click the zip >
   Extract All...). Don't run it from inside the zip.
2. Optional but recommended: check the script's fingerprint (see below).
3. Double-click "Run Download.cmd".
4. Windows will probably show "Open File - Security Warning", because the
   file came from the internet. This is expected. Choose Run only if you
   trust where the bundle came from.
5. A window lists each file as [OK], [SKIPPED] or [FAILED] with a reason.
   Press any key to close it when it finishes.

Files are saved to the "Downloaded Files" folder next to the script. Existing
files are never overwritten: a new copy is saved as "Name (2).pdf" and so on.
The full results are in download-log.csv in this folder.


CHECK THE SCRIPT'S FINGERPRINT
------------------------------
Before running a script from the internet, you can confirm it is the
published version:

1. Open PowerShell in this folder (in File Explorer, click the address bar,
   type powershell and press Enter).
2. Run:    Get-FileHash .\download-files.ps1
3. Compare the Hash value with the SHA-256 listed under "Script fingerprint"
   in the README at https://github.com/nickhafen/nh-ai-utilities
   If they don't match, don't run the script.


WHAT THE SCRIPT WILL AND WON'T DO
---------------------------------
- Downloads only http and https links.
- Saves only these file types: pdf doc docx rtf odt txt md csv xls xlsx ods
  ppt pptx odp jpg jpeg png gif tif tiff webp mp3 mp4 m4a wav zip.
  Zip files can contain anything; open them with care.
- Writes only inside "Downloaded Files", plus download-log.csv.
- Never opens or runs what it downloads. Saved files are marked as coming
  from the internet, so Office opens them in Protected View.
- Makes no registry, profile or system changes and needs no admin rights.
- Opens the "Downloaded Files" folder at the end if anything was saved.


LIMITATIONS
-----------
- No sign-in: files behind a login, paywall or CAPTCHA fail. The script does
  not use your browser's sign-in. Download those in your browser instead.
- Missing links: links added by JavaScript, or hidden behind "load more" or
  pagination, may not have been captured from the page.
- Links in PDFs have no link text, so their names come from the URL.
- Some sites send a web page (a login or error page) instead of the file;
  the script detects this and reports the row as failed.
- A site that is slow, busy or blocking automated downloads may fail; try
  again later or download those files in your browser.
- You are responsible for having the right to download the linked files.


IF SOMETHING GOES WRONG
-----------------------
- "Cannot find files.csv": unzip the whole bundle into one folder first.
- "Could not create ... Downloaded Files": move the folder somewhere you can
  write to, such as Documents.
- "path is too long": move the folder to a short path such as C:\Downloads.
- "could not reach": check your internet connection, VPN or proxy.
- Skipped rows can be fixed on the Batch Download page; export again.
`;

  const toCrlf = (text) => text.replace(/\r?\n/g, "\r\n");

  // files.csv: UTF-8 with BOM, every field quoted, CRLF line endings.
  function buildCsv(rows) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["URL", "Filename", "Extension"], ...rows.map((r) => [r.url, r.filename, r.ext])];
    return "\uFEFF" + lines.map((line) => line.map(q).join(",")).join("\r\n") + "\r\n";
  }

  // The exact files written into the zip, in order. `rows` is
  // [{ url, filename, ext }] for the checked rows.
  function bundleFiles(rows) {
    return [
      { name: "files.csv", content: buildCsv(rows) },
      { name: "download-files.ps1", content: toCrlf(SCRIPT_PS1) },
      { name: "Run Download.cmd", content: toCrlf(RUNNER_CMD) },
      { name: "README.txt", content: toCrlf(README_TXT) },
    ];
  }

  ns.batchDownloadBundle = {
    SCRIPT_PS1,
    RUNNER_CMD,
    README_TXT,
    scriptBytes: () => toCrlf(SCRIPT_PS1),
    buildCsv,
    bundleFiles,
  };
})();
