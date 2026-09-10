@echo off
setlocal EnableExtensions DisableDelayedExpansion
if "%~1"=="" goto usage
if "%~2"=="" goto usage
if not "%~3"=="" goto usage
rem Always execute the helper beside this launcher, never the installed helper.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Invoke-ReleaseUpdate.ps1" -Action Update -AppRoot "%~1" -PackagePath "%~2"
set "RX_UPDATE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %RX_UPDATE_EXIT%
:usage
echo Run from an Administrator terminal in the extracted release folder:
echo UPDATE-EXISTING-SERVER.bat "C:\NODE-SERVER\RX-APP-NEXT" "C:\Downloads\server-update-4.0.0-next.87.zip"
echo Both the installed application folder and the official ZIP path are required.
exit /b 1
