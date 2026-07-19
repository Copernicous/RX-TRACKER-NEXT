@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title RX Tracker Project Control

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell is required.
  exit /b 1
)

set "ACTION=%~1"
if not defined ACTION set "ACTION=menu"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\project-control.ps1" -Action "%ACTION%" -Value "%~2"
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
