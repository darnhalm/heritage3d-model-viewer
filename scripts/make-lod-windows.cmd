@echo off
setlocal
title Heritage3D - Make Streamed SOG

if "%~1"=="" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-lod-windows.ps1"
) else (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-lod-windows.ps1" -InputFile "%~f1"
)

exit /b %ERRORLEVEL%
