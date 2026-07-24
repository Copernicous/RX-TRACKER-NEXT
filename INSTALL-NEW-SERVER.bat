@echo off
setlocal
title RX Tracker NEXT - New Server Installer

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator permission...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
      "Start-Process -FilePath '%ComSpec%' -ArgumentList '/c','\"%~f0\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-NewServer.ps1"
set "RX_INSTALL_EXIT=%errorlevel%"

echo.
if not "%RX_INSTALL_EXIT%"=="0" (
    echo RX Tracker NEXT installation did not complete.
) else (
    echo RX Tracker NEXT installation completed successfully.
)
echo.
pause
exit /b %RX_INSTALL_EXIT%
