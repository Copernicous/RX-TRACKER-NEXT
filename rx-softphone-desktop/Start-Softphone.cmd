@echo off
setlocal
set "RXSOFT_ROOT=%~dp0"

if exist "%RXSOFT_ROOT%RxSoftphone.exe" (
  "%RXSOFT_ROOT%RxSoftphone.exe"
  exit /b %errorlevel%
)

if exist "%RXSOFT_ROOT%release\0.4.1\RxSoftphone.exe" (
  "%RXSOFT_ROOT%release\0.4.1\RxSoftphone.exe"
  exit /b %errorlevel%
)
if exist "%RXSOFT_ROOT%release\0.4.0\RxSoftphone.exe" (
  "%RXSOFT_ROOT%release\0.4.0\RxSoftphone.exe"
  exit /b %errorlevel%
)

if exist "%RXSOFT_ROOT%publish\RxSoftphone.exe" (
  "%RXSOFT_ROOT%publish\RxSoftphone.exe"
  exit /b %errorlevel%
)

if exist "%RXSOFT_ROOT%.dotnet\dotnet.exe" (
  "%RXSOFT_ROOT%.dotnet\dotnet.exe" run --project "%RXSOFT_ROOT%RxSoftphone.csproj" -c Release
  exit /b %errorlevel%
)

echo RX Native Softphone has not been built yet.
echo See README.md for build instructions.
pause
exit /b 1
