@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Install RX Tracker Project Control 2.2

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell is required.
  exit /b 1
)

set "TARGET=%~1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-ProjectControl.ps1" -TargetApp "%TARGET%"
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
