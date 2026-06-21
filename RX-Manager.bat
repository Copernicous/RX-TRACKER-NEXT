@echo off
setlocal EnableDelayedExpansion

:: Patient RX System Manager
:: Double-click this file to manage the server, database, and settings

cd /d "%~dp0"
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "ENV_FILE=%APP_DIR%\.env"

:: Load .env settings
call :LoadEnv

:MainMenu
cls
echo.
echo  ================================================
echo   PATIENT RX SYSTEM - MANAGER
echo  ================================================
echo.
echo   SERVER
echo   [1]  Start Server
echo   [2]  Stop Server
echo   [3]  Restart Server
echo   [4]  Open in Browser  (http://localhost:%PORT%)
echo   [5]  Server Status
echo.
echo   CONFIGURATION
echo   [6]  Change PostgreSQL Password
echo   [7]  Change Application Port
echo   [8]  Change JWT Secret Key
echo.
echo   DATABASE
echo   [9]  Backup Database Now
echo   [10] Restore Database from Backup
echo   [11] Initialize Fresh Database (new install)
echo.
echo   BACKUP
echo   [12] Create Full Site Backup (ZIP + Database)
echo.
echo   INFO
echo   [13] View Server Logs
echo   [14] Show Current Configuration
echo.
echo   BUILD
echo   [15] Build Portable EXE (server.exe)
echo.
echo   [0]  Exit
echo.
set /p "CHOICE=  Select option: "

if "%CHOICE%"=="1"  goto :StartServer
if "%CHOICE%"=="2"  goto :StopServer
if "%CHOICE%"=="3"  goto :RestartServer
if "%CHOICE%"=="4"  goto :OpenBrowser
if "%CHOICE%"=="5"  goto :ServerStatus
if "%CHOICE%"=="6"  goto :ChangeDBPass
if "%CHOICE%"=="7"  goto :ChangePort
if "%CHOICE%"=="8"  goto :ChangeJWT
if "%CHOICE%"=="9"  goto :BackupNow
if "%CHOICE%"=="10" goto :RestoreDB
if "%CHOICE%"=="11" goto :FreshDB
if "%CHOICE%"=="12" goto :SiteBackupMenu
if "%CHOICE%"=="13" goto :ViewLogs
if "%CHOICE%"=="14" goto :ShowConfig
if "%CHOICE%"=="15" goto :BuildEXE
if "%CHOICE%"=="0"  goto :Done
goto :MainMenu

:: ================================================
:StartServer
cls
echo.
echo  Starting Patient RX Server...
echo.
call :CheckPort
if "!PORT_IN_USE!"=="1" (
    echo  [OK] Server is already running on port %PORT%
    echo      Open: http://localhost:%PORT%
    echo.
    pause
    goto :MainMenu
)
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
start "PatientRX-Server" /MIN cmd /c "cd /d "%APP_DIR%" && node app.js >> "%APP_DIR%\logs\server.log" 2>&1"
echo  Waiting for server to start...
timeout /t 4 /nobreak >nul
call :CheckPort
if "!PORT_IN_USE!"=="1" (
    echo  [OK] Server started!
    echo      Open: http://localhost:%PORT%
) else (
    echo  [!] Server may still be loading... check logs if it fails.
    echo      Option [13] to view logs.
)
echo.
pause
goto :MainMenu

:: ================================================
:StopServer
cls
echo.
echo  Stopping server...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1
taskkill /FI "IMAGENAME eq server.exe" /F >nul 2>&1
echo  [OK] Server stopped.
echo.
pause
goto :MainMenu

:: ================================================
:RestartServer
cls
echo.
echo  Restarting server...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul
goto :StartServer

:: ================================================
:OpenBrowser
start "" "http://localhost:%PORT%"
goto :MainMenu

:: ================================================
:ServerStatus
cls
echo.
echo  ================================================
echo   SERVER STATUS
echo  ================================================
echo.
call :CheckPort
if "!PORT_IN_USE!"=="1" (
    echo  [RUNNING]  App is responding on port %PORT%
    echo             Open: http://localhost:%PORT%
) else (
    echo  [STOPPED]  Nothing on port %PORT%
)
echo.
echo  Checking PostgreSQL...
set "PGPASSWORD=%DB_PASS%"
psql -U %DB_USER% -h %DB_HOST% -c "\conninfo" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  [RUNNING]  PostgreSQL connected  (DB: %DB_NAME%)
) else (
    echo  [ERROR]    Cannot connect to PostgreSQL
    echo             Is PostgreSQL running?
)
echo.
echo  PORT: %PORT%   DB: %DB_NAME%   HOST: %DB_HOST%
echo.
pause
goto :MainMenu

:: ================================================
:ChangeDBPass
cls
echo.
echo  ================================================
echo   CHANGE POSTGRESQL PASSWORD
echo  ================================================
echo.
echo  This will:
echo    1. Change the password in PostgreSQL
echo    2. Update .env file automatically
echo.
set /p "NEW_PASS=  Enter NEW password: "
if "%NEW_PASS%"=="" (
    echo  Cancelled.
    pause
    goto :MainMenu
)
echo.
echo  Applying changes...
set "PGPASSWORD=%DB_PASS%"
psql -U %DB_USER% -h %DB_HOST% -c "ALTER USER %DB_USER% PASSWORD '%NEW_PASS%';" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Could not connect to PostgreSQL.
    echo          Is it running? Check option [5] for status.
    pause
    goto :MainMenu
)
echo  [OK] PostgreSQL password changed.
call :UpdateEnvLine "DB_PASS" "%NEW_PASS%"
set "DB_PASS=%NEW_PASS%"
set "PGPASSWORD=%NEW_PASS%"
echo  [OK] .env file updated.
echo.
echo  Password changed successfully!
echo.
set /p "RST=  Restart server now? (Y/N): "
if /i "%RST%"=="Y" goto :RestartServer
goto :MainMenu

:: ================================================
:ChangePort
cls
echo.
echo  Current port: %PORT%
echo.
set /p "NEW_PORT=  Enter new port (e.g. 3000, 3001, 8080): "
if "%NEW_PORT%"=="" goto :MainMenu
call :UpdateEnvLine "PORT" "%NEW_PORT%"
call :UpdateEnvLine "APP_ORIGIN" "http://localhost:%NEW_PORT%"
set "PORT=%NEW_PORT%"
echo.
echo  [OK] Port changed to %NEW_PORT%
echo       Restart the server for changes to take effect.
echo.
pause
goto :MainMenu

:: ================================================
:ChangeJWT
cls
echo.
echo  ================================================
echo   CHANGE JWT SECRET KEY
echo  ================================================
echo.
echo  Warning: Changing this will log out all current users.
echo.
echo  [1] Enter a custom secret
echo  [2] Auto-generate a random secret
echo.
set /p "JC=  Select: "
if "%JC%"=="2" (
    set "NEW_JWT=RXSystem_%RANDOM%%RANDOM%_Key%RANDOM%"
    echo  Generated: !NEW_JWT!
) else (
    set /p "NEW_JWT=  Enter new JWT secret (at least 20 characters): "
)
if "%NEW_JWT%"=="" goto :MainMenu
if "!NEW_JWT!"=="" goto :MainMenu
call :UpdateEnvLine "JWT_SECRET" "!NEW_JWT!"
echo.
echo  [OK] JWT Secret updated.
echo       Restart server for this to take effect.
echo.
pause
goto :MainMenu

:: ================================================
:BackupNow
cls
echo.
echo  Creating database backup...
echo.
if not exist "%APP_DIR%\backups" mkdir "%APP_DIR%\backups"

:: Build timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "DT=%%I"
set "STAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%-%DT:~10,2%"
set "DUMPFILE=%APP_DIR%\backups\backup_%STAMP%.dump"

set "PGPASSWORD=%DB_PASS%"
pg_dump -U %DB_USER% -h %DB_HOST% -d %DB_NAME% -F c -f "%DUMPFILE%"
if %ERRORLEVEL% EQU 0 (
    echo.
    echo  [OK] Backup saved:
    echo       %DUMPFILE%
) else (
    echo.
    echo  [ERROR] Backup failed. Is PostgreSQL running?
)
echo.
pause
goto :MainMenu

:: ================================================
:RestoreDB
cls
echo.
echo  ================================================
echo   RESTORE DATABASE FROM BACKUP
echo  ================================================
echo.
echo  Available backup files in backups\ folder:
echo.

set "IDX=0"
for %%F in ("%APP_DIR%\backups\*.dump") do (
    set /a IDX+=1
    echo  [!IDX!] %%~nxF
    set "DUMP_!IDX!=%%F"
)
if %IDX%==0 (
    echo  No backup files found.
    echo  Create one with option [9] first.
    echo.
    pause
    goto :MainMenu
)
echo.
set /p "DC=  Select number to restore (0 to cancel): "
if "%DC%"=="0" goto :MainMenu
if "%DC%"=="" goto :MainMenu

set "SELECTED=!DUMP_%DC%!"
if "!SELECTED!"=="" (
    echo  Invalid selection.
    pause
    goto :MainMenu
)
echo.
echo  WARNING: This will REPLACE all current data!
echo  File: !SELECTED!
echo.
set /p "CONF=  Type YES to confirm: "
if /i NOT "%CONF%"=="YES" (
    echo  Cancelled.
    pause
    goto :MainMenu
)

echo.
echo  Stopping server...
taskkill /FI "WINDOWTITLE eq PatientRX-Server" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo  Dropping and recreating database...
set "PGPASSWORD=%DB_PASS%"
psql -U %DB_USER% -h %DB_HOST% -c "DROP DATABASE IF EXISTS %DB_NAME%;" postgres
psql -U %DB_USER% -h %DB_HOST% -c "CREATE DATABASE %DB_NAME%;" postgres
echo  Restoring data...
pg_restore -U %DB_USER% -h %DB_HOST% -d %DB_NAME% --no-owner --no-privileges "!SELECTED!"
echo.
echo  [OK] Restore complete! Starting server...
timeout /t 1 /nobreak >nul
goto :StartServer

:: ================================================
:FreshDB
cls
echo.
echo  ================================================
echo   INITIALIZE FRESH DATABASE
echo  ================================================
echo.
echo  This creates a NEW empty database with a default admin.
echo  Use ONLY for a brand new installation.
echo.
set /p "CONF=  Type YES to continue: "
if /i NOT "%CONF%"=="YES" goto :MainMenu
echo.
set "PGPASSWORD=%DB_PASS%"
echo  Creating database...
psql -U %DB_USER% -h %DB_HOST% -c "CREATE DATABASE %DB_NAME%;" postgres 2>nul
echo  Installing packages...
call npm install --silent
echo  Creating tables (running migrations)...
call npx sequelize-cli db:migrate
echo  Creating default admin account...
call npx sequelize-cli db:seed:all
echo.
echo  [OK] Database ready!
echo       Login: admin / admin123
echo       IMPORTANT: Change the password after first login!
echo.
pause
goto :MainMenu

:: ================================================
:SiteBackupMenu
cls
echo.
echo  Creating Full Site Backup...
echo  (Application code + Database dump as one ZIP file)
echo  This may take 30-60 seconds...
echo.

if not exist "C:\RX-SiteBackups" mkdir "C:\RX-SiteBackups"
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "DT=%%I"
set "STAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%-%DT:~10,2%"
set "TMPFILE=C:\RX-SiteBackups\_temp_%STAMP%.dump"
set "ZIPFILE=C:\RX-SiteBackups\RX_SiteBackup_%STAMP%.zip"

echo  Step 1/2 - Saving database...
set "PGPASSWORD=%DB_PASS%"
pg_dump -U %DB_USER% -h %DB_HOST% -d %DB_NAME% -F c -f "%TMPFILE%"
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Database dump failed. Is PostgreSQL running?
    pause
    goto :MainMenu
)

echo  Step 2/2 - Creating ZIP archive...
set "PSCMD=Add-Type -Assembly System.IO.Compression.FileSystem; $src='%APP_DIR%'; $dest='%ZIPFILE%'; $dump='%TMPFILE%'; $ex=@('node_modules','.git','logs'); $files=Get-ChildItem -Path $src -Recurse -File | Where-Object { $rel=$_.FullName.Substring($src.Length+1); $parts=$rel -split '[/\\]'; $skip=$false; foreach($e in $ex){if($parts -contains $e){$skip=$true;break}}; -not $skip }; if(Test-Path $dest){Remove-Item $dest -Force}; $zip=[System.IO.Compression.ZipFile]::Open($dest,'Create'); foreach($f in $files){$e=$f.FullName.Substring($src.Length+1); try{[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$f.FullName,$e)|Out-Null}catch{}}; try{[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$dump,'db_backup.dump')|Out-Null}catch{}; $zip.Dispose(); Remove-Item $dump -Force -ErrorAction SilentlyContinue; Write-Host 'DONE'"

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "%PSCMD%"

if exist "%ZIPFILE%" (
    echo.
    echo  [OK] Backup saved to:
    echo       %ZIPFILE%
) else (
    echo.
    echo  [ERROR] ZIP creation failed.
)
echo.
pause
goto :MainMenu

:: ================================================
:ViewLogs
cls
echo.
echo  ================================================
echo   SERVER LOGS (last 40 lines)
echo  ================================================
echo.
if exist "%APP_DIR%\logs\server.log" (
    powershell -Command "Get-Content '%APP_DIR%\logs\server.log' -Tail 40"
) else (
    echo  No log file found yet.
    echo  The server may output directly to its window.
)
echo.
pause
goto :MainMenu

:: ================================================
:ShowConfig
cls
echo.
echo  ================================================
echo   CURRENT CONFIGURATION
echo  ================================================
echo.
echo  Web Server
echo  ----------
echo  Port:         %PORT%
echo  App URL:      %APP_ORIGIN%
echo  Timezone:     %TZ%
echo.
echo  Database
echo  ----------
echo  Host:         %DB_HOST%
echo  Database:     %DB_NAME%
echo  User:         %DB_USER%
echo  Password:     %DB_PASS:~0,3%****** (hidden for security)
echo.
echo  Security
echo  ----------
set "JSHORT=%JWT_SECRET:~0,6%"
echo  JWT Secret:   %JSHORT%****** (hidden)
echo.
echo  Email (SMTP)
echo  ----------
echo  SMTP Host:    %SMTP_HOST%
echo  SMTP Port:    %SMTP_PORT%
echo  SMTP User:    %SMTP_USER%
echo.
echo  Paths
echo  ----------
echo  App folder:   %APP_DIR%
echo  DB Backups:   %APP_DIR%\backups\
echo  Site Backups: C:\RX-SiteBackups\
echo.
pause
goto :MainMenu

:: ================================================
:BuildEXE
cls
echo.
echo  ================================================
echo   BUILD PORTABLE server.exe
echo  ================================================
echo.
echo  This compiles the app into server.exe
echo  No Node.js installation needed on the target PC.
echo  PostgreSQL still needs to be installed separately.
echo.
echo  Build will take 2-5 minutes on first run.
echo.
set /p "CONF=  Start build? (Y/N): "
if /i NOT "%CONF%"=="Y" goto :MainMenu
echo.
echo  Installing/verifying pkg...
call npm install -g pkg >nul 2>&1

if not exist "%APP_DIR%\dist" mkdir "%APP_DIR%\dist"
echo  Building server.exe (this may take a few minutes)...
cd /d "%APP_DIR%"

:: Use full path to pkg.cmd — avoids PATH refresh issues in current session
set "PKG_CMD=%APPDATA%\npm\pkg.cmd"
if not exist "!PKG_CMD!" set "PKG_CMD=%APPDATA%\npm\pkg"

call "!PKG_CMD!" app.js --target node18-win-x64 --output dist\server.exe --compress GZip
if %ERRORLEVEL% EQU 0 (
    echo.
    echo  [OK] Built: %APP_DIR%\dist\server.exe
    echo.
    echo  Copy these files to the new PC:
    echo    dist\server.exe
    echo    .env
    echo    views\
    echo    public\
    echo    migrations\
    echo    seeders\
    echo    setup.bat
    echo    RX-Manager.bat
) else (
    echo.
    echo  [!] Trying via npx...
    call npx pkg app.js --target node18-win-x64 --output dist\server.exe --compress GZip
    if !ERRORLEVEL! EQU 0 (
        echo  [OK] Built successfully!
    ) else (
        echo  [ERROR] Build failed. Try running: npm install -g pkg
        echo          Then re-open RX-Manager.bat and try again.
    )
)
echo.
pause
goto :MainMenu


:: ================================================
:Done
exit /b 0

:: ================================================
:: HELPER: Check if something is on the configured port
:CheckPort
set "PORT_IN_USE=0"
powershell -Command "try{$r=(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',%PORT%);$r.Close();exit 0}catch{exit 1}" >nul 2>&1
if %ERRORLEVEL% EQU 0 set "PORT_IN_USE=1"
goto :eof

:: ================================================
:: HELPER: Load .env into variables
:LoadEnv
set "PORT=3000"
set "DB_USER=postgres"
set "DB_PASS="
set "DB_NAME=patient_rx_dev"
set "DB_HOST=127.0.0.1"
set "JWT_SECRET="
set "TZ=America/New_York"
set "SMTP_HOST=smtp.gmail.com"
set "SMTP_PORT=587"
set "SMTP_USER="
set "APP_ORIGIN=http://localhost:3000"
if not exist "%ENV_FILE%" goto :eof
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "_K=%%A"
    set "_V=%%B"
    :: Skip comment lines
    echo !_K! | findstr /B "#" >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        if "!_K!"=="PORT"        set "PORT=!_V!"
        if "!_K!"=="DB_USER"     set "DB_USER=!_V!"
        if "!_K!"=="DB_PASS"     set "DB_PASS=!_V!"
        if "!_K!"=="DB_NAME"     set "DB_NAME=!_V!"
        if "!_K!"=="DB_HOST"     set "DB_HOST=!_V!"
        if "!_K!"=="JWT_SECRET"  set "JWT_SECRET=!_V!"
        if "!_K!"=="TZ"          set "TZ=!_V!"
        if "!_K!"=="SMTP_HOST"   set "SMTP_HOST=!_V!"
        if "!_K!"=="SMTP_PORT"   set "SMTP_PORT=!_V!"
        if "!_K!"=="SMTP_USER"   set "SMTP_USER=!_V!"
        if "!_K!"=="APP_ORIGIN"  set "APP_ORIGIN=!_V!"
    )
)
set "PGPASSWORD=%DB_PASS%"
goto :eof

:: ================================================
:: HELPER: Update one key=value line in .env
:UpdateEnvLine
set "_KEY=%~1"
set "_VAL=%~2"
set "_TMP=%ENV_FILE%.tmp"
if exist "%_TMP%" del /Q "%_TMP%"
for /f "usebackq delims=" %%L in ("%ENV_FILE%") do (
    set "_LINE=%%L"
    echo !_LINE! | findstr /B /C:"!_KEY!=" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo !_KEY!=!_VAL!>>"%_TMP%"
    ) else (
        echo !_LINE!>>"%_TMP%"
    )
)
move /Y "%_TMP%" "%ENV_FILE%" >nul
goto :eof
