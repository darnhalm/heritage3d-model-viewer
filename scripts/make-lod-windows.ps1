[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$InputFile,

    [string]$OutputDirectory,

    [string[]]$LodLevels = @('50%', '25%', '12.5%', '6.25%', '3.125%'),

    [ValidateRange(32, 4096)]
    [int]$ChunkCount = 512,

    [ValidateSet('0', '1', '2', '3')]
    [string]$FilterHarmonics,

    [string]$Gpu,

    [string]$SplatTransformVersion = '3.1.7',

    [string]$DependencyDirectory,

    [switch]$Force,
    [switch]$KeepTemp,
    [switch]$IgnoreDiskCheck,
    [switch]$NoDependencyDownload,
    [switch]$NoPause
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:NpxPath = $null
$script:WorkDirectory = $null
$script:TempDirectory = $null
$script:TilesDirectory = $null
$script:LogPath = $null

function Stop-WithMessage {
    param([string]$Message)
    throw $Message
}

function Select-SplatFile {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Select a Gaussian Splat scene'
    $dialog.Filter = 'Gaussian Splats (*.ply;*.sog;*.spz;*.splat;*.ksplat)|*.ply;*.sog;*.spz;*.splat;*.ksplat|All files (*.*)|*.*'
    $dialog.Multiselect = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Stop-WithMessage 'No input file selected.'
    }
    return $dialog.FileName
}

function Format-Bytes {
    param([long]$Bytes)
    if ($Bytes -ge 1TB) { return '{0:N2} TB' -f ($Bytes / 1TB) }
    if ($Bytes -ge 1GB) { return '{0:N2} GB' -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return '{0:N1} MB' -f ($Bytes / 1MB) }
    return "$Bytes bytes"
}

function Get-PortableNodeArchitecture {
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if ([string]::IsNullOrWhiteSpace($architecture)) {
        $architecture = $env:PROCESSOR_ARCHITECTURE
    }

    if ($architecture -match 'ARM64') { return 'win-arm64' }
    if ($architecture -match 'AMD64|x86_64') { return 'win-x64' }
    Stop-WithMessage "Unsupported Windows architecture: $architecture. Install Node.js manually."
}

function Install-PortableNode {
    param([string]$DestinationRoot)

    if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
        $localData = $env:LOCALAPPDATA
        if ([string]::IsNullOrWhiteSpace($localData)) {
            $localData = Join-Path $env:USERPROFILE 'AppData\Local'
        }
        $DestinationRoot = Join-Path $localData 'Heritage3D\dependencies'
    }

    $platform = Get-PortableNodeArchitecture
    $indexUrl = 'https://nodejs.org/dist/index.json'
    Write-Host 'Node.js was not found. Downloading an official portable Node.js LTS...' -ForegroundColor Yellow
    Write-Progress -Activity 'Installing dependencies' -Status 'Reading the Node.js LTS release index' -PercentComplete 5

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $releases = Invoke-RestMethod -Uri $indexUrl -UseBasicParsing
    } catch {
        Stop-WithMessage "Cannot read $indexUrl. Check the internet connection: $($_.Exception.Message)"
    }

    $fileKind = "$platform-zip"
    $release = $releases | Where-Object {
        [bool]$_.lts -and @($_.files) -contains $fileKind
    } | Select-Object -First 1
    if ($null -eq $release) {
        Stop-WithMessage "The Node.js release index contains no LTS build for $platform."
    }

    $version = [string]$release.version
    $archiveName = "node-$version-$platform.zip"
    $releaseUrl = "https://nodejs.org/dist/$version"
    $nodeDirectory = Join-Path $DestinationRoot "node-$version-$platform"
    $npxPath = Join-Path $nodeDirectory 'npx.cmd'
    if (Test-Path -LiteralPath $npxPath -PathType Leaf) {
        Write-Progress -Activity 'Installing dependencies' -Completed
        return $npxPath
    }

    $downloadDirectory = Join-Path $DestinationRoot 'downloads'
    New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
    $archivePath = Join-Path $downloadDirectory $archiveName
    $checksumUrl = "$releaseUrl/SHASUMS256.txt"

    Write-Progress -Activity 'Installing dependencies' -Status 'Downloading the official checksum' -PercentComplete 10
    try {
        $checksumText = (Invoke-WebRequest -Uri $checksumUrl -UseBasicParsing).Content
    } catch {
        Stop-WithMessage "Cannot download $checksumUrl`: $($_.Exception.Message)"
    }

    $escapedArchiveName = [regex]::Escape($archiveName)
    $checksumMatch = [regex]::Match([string]$checksumText, "(?im)^([a-f0-9]{64})\s+$escapedArchiveName\s*$")
    if (-not $checksumMatch.Success) {
        Stop-WithMessage "No SHA-256 entry for $archiveName in the official checksum file."
    }
    $expectedHash = $checksumMatch.Groups[1].Value.ToUpperInvariant()

    $archiveIsValid = $false
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        $archiveIsValid = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -eq $expectedHash
    }
    if (-not $archiveIsValid) {
        $partialPath = "$archivePath.download"
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        Write-Host "Downloading $archiveName from nodejs.org..."
        Write-Progress -Activity 'Installing dependencies' -Status "Downloading $archiveName" -PercentComplete 25
        try {
            Invoke-WebRequest -Uri "$releaseUrl/$archiveName" -OutFile $partialPath -UseBasicParsing
        } catch {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
            Stop-WithMessage "Node.js download failed: $($_.Exception.Message)"
        }

        $actualHash = (Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash
        if ($actualHash -ne $expectedHash) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
            Stop-WithMessage "SHA-256 verification failed for $archiveName. The downloaded file was deleted."
        }
        Move-Item -LiteralPath $partialPath -Destination $archivePath -Force
    }

    Write-Progress -Activity 'Installing dependencies' -Status 'Extracting portable Node.js' -PercentComplete 80
    $stagingDirectory = Join-Path $DestinationRoot ('.extract-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
    try {
        Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingDirectory -Force
        $extractedDirectory = Join-Path $stagingDirectory "node-$version-$platform"
        if (-not (Test-Path -LiteralPath (Join-Path $extractedDirectory 'npx.cmd') -PathType Leaf)) {
            Stop-WithMessage 'The portable Node.js archive has an unexpected structure.'
        }
        if (Test-Path -LiteralPath $nodeDirectory) {
            Remove-Item -LiteralPath $nodeDirectory -Recurse -Force
        }
        Move-Item -LiteralPath $extractedDirectory -Destination $nodeDirectory
    } finally {
        if (Test-Path -LiteralPath $stagingDirectory) {
            Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
        }
    }

    if (-not (Test-Path -LiteralPath $npxPath -PathType Leaf)) {
        Stop-WithMessage 'Portable Node.js extraction completed, but npx.cmd is missing.'
    }

    Write-Progress -Activity 'Installing dependencies' -Status "Installed Node.js $version" -PercentComplete 100
    Write-Progress -Activity 'Installing dependencies' -Completed
    Write-Host "Portable Node.js $version installed in $nodeDirectory" -ForegroundColor Green
    return $npxPath
}

function Get-NpxPath {
    $npxCommand = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if ($null -eq $npxCommand) { $npxCommand = Get-Command npx -ErrorAction SilentlyContinue }
    if ($null -ne $npxCommand) { return $npxCommand.Source }

    if ($NoDependencyDownload) {
        Stop-WithMessage 'Node.js is required and automatic dependency downloading is disabled.'
    }
    return Install-PortableNode -DestinationRoot $DependencyDirectory
}

function Quote-NativeArgument {
    param([string]$Value)
    if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }

    # Windows CommandLineToArgvW quoting rules.
    $quoted = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $quoted = [regex]::Replace($quoted, '(\\+)$', '$1$1')
    return '"' + $quoted + '"'
}

function Invoke-TrackedProcess {
    param(
        [string]$Label,
        [int]$CompletedPhases,
        [int]$TotalPhases,
        [string[]]$Arguments
    )

    $stdoutPath = Join-Path $script:WorkDirectory 'last-command.stdout.log'
    $stderrPath = Join-Path $script:WorkDirectory 'last-command.stderr.log'
    Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

    $argumentLine = ($Arguments | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join ' '
    Add-Content -LiteralPath $script:LogPath -Value "`r`n> npx $argumentLine"

    $started = Get-Date
    $process = Start-Process -FilePath $script:NpxPath -ArgumentList $argumentLine `
        -WorkingDirectory $script:WorkDirectory -NoNewWindow -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $basePercent = [math]::Floor(($CompletedPhases * 100) / $TotalPhases)
    while (-not $process.HasExited) {
        $elapsed = (Get-Date) - $started
        Write-Progress -Activity 'Creating Streamed SOG' -Status "$Label - elapsed $($elapsed.ToString('hh\:mm\:ss'))" `
            -PercentComplete $basePercent
        Start-Sleep -Seconds 1
        $process.Refresh()
    }

    $process.WaitForExit()
    if (Test-Path -LiteralPath $stdoutPath) {
        Get-Content -LiteralPath $stdoutPath | Tee-Object -FilePath $script:LogPath -Append | Out-Host
    }
    if (Test-Path -LiteralPath $stderrPath) {
        Get-Content -LiteralPath $stderrPath | Tee-Object -FilePath $script:LogPath -Append | Out-Host
    }

    if ($process.ExitCode -ne 0) {
        Stop-WithMessage "$Label failed with exit code $($process.ExitCode). See $script:LogPath"
    }

    $donePercent = [math]::Floor((($CompletedPhases + 1) * 100) / $TotalPhases)
    Write-Progress -Activity 'Creating Streamed SOG' -Status "$Label - complete" -PercentComplete $donePercent
}

function Assert-StreamedSog {
    param([string]$MetadataPath)

    if (-not (Test-Path -LiteralPath $MetadataPath -PathType Leaf)) {
        Stop-WithMessage "Output metadata was not created: $MetadataPath"
    }

    try {
        $metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
    } catch {
        Stop-WithMessage "Invalid lod-meta.json: $($_.Exception.Message)"
    }

    if ($null -eq $metadata.filenames -or @($metadata.filenames).Count -eq 0) {
        Stop-WithMessage 'lod-meta.json contains no tile filenames.'
    }

    $missing = @()
    foreach ($relativeName in @($metadata.filenames)) {
        $relativeWindowsPath = ([string]$relativeName).Replace('/', [IO.Path]::DirectorySeparatorChar)
        $tileMetadata = Join-Path $script:TilesDirectory $relativeWindowsPath
        if (-not (Test-Path -LiteralPath $tileMetadata -PathType Leaf)) {
            $missing += [string]$relativeName
        }
    }

    if ($missing.Count -gt 0) {
        Stop-WithMessage "Missing $($missing.Count) tile metadata files. First missing file: $($missing[0])"
    }

    return $metadata
}

$exitCode = 0
try {
    if ([string]::IsNullOrWhiteSpace($InputFile)) {
        $InputFile = Select-SplatFile
    }

    $inputItem = Get-Item -LiteralPath $InputFile -ErrorAction Stop
    $InputFile = $inputItem.FullName
    $supportedExtensions = @('.ply', '.sog', '.spz', '.splat', '.ksplat')
    if ($supportedExtensions -notcontains $inputItem.Extension.ToLowerInvariant()) {
        Stop-WithMessage "Unsupported input format: $($inputItem.Extension)"
    }

    $script:NpxPath = Get-NpxPath

    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $baseName = [IO.Path]::GetFileNameWithoutExtension($inputItem.Name)
        if ($baseName.EndsWith('.compressed', [StringComparison]::OrdinalIgnoreCase)) {
            $baseName = $baseName.Substring(0, $baseName.Length - '.compressed'.Length)
        }
        $OutputDirectory = Join-Path $inputItem.DirectoryName ($baseName + '-lod')
    }
    $OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

    $script:WorkDirectory = $OutputDirectory
    $script:TempDirectory = Join-Path $OutputDirectory 'tmp'
    $script:TilesDirectory = Join-Path $OutputDirectory 'tiles'
    $script:LogPath = Join-Path $OutputDirectory 'make-lod.log'
    $lodMetadataPath = Join-Path $script:TilesDirectory 'lod-meta.json'

    if ((Test-Path -LiteralPath $lodMetadataPath) -and -not $Force) {
        Stop-WithMessage "A completed result already exists: $lodMetadataPath. Use -Force to rebuild it."
    }
    if ($Force -and (Test-Path -LiteralPath $OutputDirectory)) {
        $leaf = Split-Path -Leaf $OutputDirectory
        if (-not $leaf.EndsWith('-lod', [StringComparison]::OrdinalIgnoreCase)) {
            Stop-WithMessage "For safety, -Force only removes directories whose names end in '-lod'."
        }
        Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
    }

    New-Item -ItemType Directory -Path $script:TempDirectory, $script:TilesDirectory -Force | Out-Null
    "Started: $(Get-Date -Format o)`r`nInput: $InputFile" | Set-Content -LiteralPath $script:LogPath

    $driveRoot = [IO.Path]::GetPathRoot($OutputDirectory)
    $drive = New-Object IO.DriveInfo($driveRoot)
    $estimatedRequired = [long]($inputItem.Length * 20 + 512MB)
    Write-Host "Input:  $InputFile ($(Format-Bytes $inputItem.Length))"
    Write-Host "Output: $OutputDirectory"
    Write-Host "Free:   $(Format-Bytes $drive.AvailableFreeSpace); conservative requirement: $(Format-Bytes $estimatedRequired)"
    if (-not $IgnoreDiskCheck -and $drive.AvailableFreeSpace -lt $estimatedRequired) {
        Stop-WithMessage 'Not enough free disk space. Free more space or use -IgnoreDiskCheck if the input is already uncompressed PLY.'
    }

    $packageArg = "@playcanvas/splat-transform@$SplatTransformVersion"
    $commonArguments = @('--yes', $packageArg)
    if (-not [string]::IsNullOrWhiteSpace($Gpu)) {
        $commonArguments += @('-g', $Gpu)
    }

    $totalPhases = $LodLevels.Count + 2
    Invoke-TrackedProcess -Label 'Inspecting source' -CompletedPhases 0 -TotalPhases $totalPhases `
        -Arguments ($commonArguments + @($InputFile, '--info', 'null'))

    $levelInputs = @($InputFile, '-l', '0')
    for ($index = 0; $index -lt $LodLevels.Count; $index++) {
        $levelNumber = $index + 1
        $levelPath = Join-Path $script:TempDirectory "lod$levelNumber.ply"
        if ((Test-Path -LiteralPath $levelPath) -and (Get-Item -LiteralPath $levelPath).Length -gt 0) {
            Write-Host "Reusing checkpoint: $levelPath"
            Write-Progress -Activity 'Creating Streamed SOG' -Status "LOD $levelNumber checkpoint found" `
                -PercentComplete ([math]::Floor((($index + 2) * 100) / $totalPhases))
        } else {
            $filterArguments = @('--filter-nan')
            if (-not [string]::IsNullOrWhiteSpace($FilterHarmonics)) {
                $filterArguments += @('--filter-harmonics', $FilterHarmonics)
            }
            Invoke-TrackedProcess -Label "Generating LOD $levelNumber/$($LodLevels.Count) ($($LodLevels[$index]))" `
                -CompletedPhases ($index + 1) -TotalPhases $totalPhases `
                -Arguments ($commonArguments + @($InputFile) + $filterArguments + @(
                    '--decimate', $LodLevels[$index], $levelPath, '--scratch-dir', $script:TempDirectory
                ))
        }
        $levelInputs += @($levelPath, '-l', [string]$levelNumber)
    }

    $assemblyArguments = $commonArguments + @('--lod-chunk-count', [string]$ChunkCount) + $levelInputs + @($lodMetadataPath, '--filter-nan')
    if (-not [string]::IsNullOrWhiteSpace($FilterHarmonics)) {
        $assemblyArguments += @('--filter-harmonics', $FilterHarmonics)
    }
    Invoke-TrackedProcess -Label 'Compressing and writing tiles' `
        -CompletedPhases ($totalPhases - 1) -TotalPhases $totalPhases -Arguments $assemblyArguments

    $metadata = Assert-StreamedSog -MetadataPath $lodMetadataPath
    $outputFiles = @(Get-ChildItem -LiteralPath $script:TilesDirectory -File -Recurse)
    $outputBytes = ($outputFiles | Measure-Object -Property Length -Sum).Sum

    if (-not $KeepTemp -and (Test-Path -LiteralPath $script:TempDirectory)) {
        Remove-Item -LiteralPath $script:TempDirectory -Recurse -Force
    }

    Write-Progress -Activity 'Creating Streamed SOG' -Completed
    Write-Host ''
    Write-Host 'DONE' -ForegroundColor Green
    Write-Host "LOD levels: $($metadata.lodLevels)"
    Write-Host "Tile metadata files: $(@($metadata.filenames).Count)"
    Write-Host "Output files: $($outputFiles.Count); size: $(Format-Bytes ([long]$outputBytes))"
    Write-Host "Open this file in the viewer: $lodMetadataPath"
    Write-Host "Log: $script:LogPath"
} catch {
    $exitCode = 1
    Write-Progress -Activity 'Creating Streamed SOG' -Completed
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($script:LogPath -and (Test-Path -LiteralPath $script:LogPath)) {
        Write-Host "Log: $script:LogPath"
    }
    if ($script:TempDirectory -and (Test-Path -LiteralPath $script:TempDirectory)) {
        Write-Host 'Temporary LOD files were preserved. Run the same command again to continue.'
    }
} finally {
    if (-not $NoPause -and $Host.Name -eq 'ConsoleHost') {
        Write-Host ''
        Read-Host 'Press Enter to close'
    }
}

exit $exitCode
