# Streamed SOG on Windows

`scripts/make-lod-windows.cmd` converts a Gaussian Splat into a local Streamed SOG
dataset (`lod-meta.json` plus spatial LOD chunks).

## Requirements

- Windows 10 or 11;
- an internet connection on the first run;
- an SSD with enough free space (the preflight check conservatively requires 20 times
  the input size);
- current NVIDIA drivers if GPU compression is used.

No manual dependency installation is required. If Node.js is missing, the script downloads
the current official portable Node.js LTS ZIP from <https://nodejs.org/>, verifies it against
the published `SHASUMS256.txt`, and extracts it without administrator rights to:

```text
%LOCALAPPDATA%\Heritage3D\dependencies
```

It then downloads the pinned `@playcanvas/splat-transform` package through `npx`. Both are
cached for later runs. Existing system Node.js installations are used as-is.

## Easiest start

Drag a `.ply`, `.sog`, `.spz`, `.splat`, or `.ksplat` file onto:

```text
scripts\make-lod-windows.cmd
```

Alternatively, double-click the CMD file and choose the source in the file dialog. The
result is created beside the source in `<source-name>-lod\tiles\`.

The progress bar is phase-based because `splat-transform` does not report a reliable
percentage inside long decimation and compression phases. Elapsed time continues to
update while a phase is running. Full tool output is written to `make-lod.log`.

## PowerShell usage

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\make-lod-windows.ps1 `
  -InputFile "D:\models\scene.ply"
```

Quality-first example with additional LOD levels and default spherical harmonics:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\make-lod-windows.ps1 `
  -InputFile "D:\models\scene.ply" `
  -LodLevels '50%','25%','12.5%','6.25%','3.125%' `
  -ChunkCount 512 `
  -Gpu 0
```

Do not pass `-FilterHarmonics` when maximum view-dependent colour quality is wanted.
Use `-FilterHarmonics 0` only when reducing output size is more important.

Check available GPU adapters before a long conversion:

```powershell
npx --yes @playcanvas/splat-transform@3.1.7 --list-gpus
```

## Recovery and safety

- Completed intermediate LOD files are checkpoints. If conversion fails, run the same
  command again and they will be reused.
- Temporary files are deleted only after a valid `lod-meta.json` and all referenced tile
  metadata files have been verified.
- Use `-KeepTemp` to retain intermediate PLY files after success.
- Existing completed output is not overwritten. Use `-Force` to rebuild it; for safety,
  `-Force` only removes a directory whose name ends in `-lod`.
- Use `-IgnoreDiskCheck` only when the conservative check is inappropriate, for example
  when the source is already a large uncompressed PLY.
- Use `-NoDependencyDownload` to require a preinstalled Node.js and disable automatic
  downloads. `-DependencyDirectory "D:\tools\heritage3d"` changes the portable cache path.

The Windows script creates files locally. Upload to object storage is intentionally a
separate step so a successful multi-hour conversion is never deleted because of an
upload or credential problem.
