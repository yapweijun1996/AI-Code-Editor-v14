@echo off
setlocal enabledelayedexpansion

REM === Change directory to the script location ===
cd /d "%~dp0"

REM ===============================================================================
REM  SELF-HEALING PRE-FLIGHT CHECK
REM ===============================================================================
for /f "delims=" %%i in ('npm config get prefix 2^>nul') do set "NPM_DIR=%%i"
if defined NPM_DIR (
    echo "!Path!" | findstr /I /C:"!NPM_DIR!" >nul
    if !errorlevel! neq 0 (
        set "Path=!Path!;!NPM_DIR!"
    )
)

REM Set the name for the PM2 process
set "PM2_APP_NAME=ai-editor-backend"

REM Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    set "isAdmin=false"
) else (
    set "isAdmin=true"
)

:menu
cls
echo =================================================================
echo  AI Code Editor - Server Management
echo =================================================================
echo.
echo  -- Standard Operations --
echo  [1] Install Dependencies (Run this first)
echo  [2] Start Server
echo  [3] Stop Server
echo  [4] Restart Server
echo  [5] View Server Status
echo.
echo  -- Administrative Tasks (Requires Admin) --
echo  [6] Enable Auto-Startup on Reboot
echo  [7] Disable Auto-Startup on Reboot
echo  [X] Nuke PM2 (Complete Reset)
echo.
echo  [0] Exit
echo.
set /p choice="Enter your choice: "

if "%choice%"=="1" goto install
if "%choice%"=="2" goto start
if "%choice%"=="3" goto stop
if "%choice%"=="4" goto restart
if "%choice%"=="5" goto status
if "%choice%"=="6" goto admin_check
if "%choice%"=="7" goto admin_check
if /i "%choice%"=="X" goto admin_check
if "%choice%"=="0" goto :eof

echo Invalid choice. Please try again.
pause
goto menu

:admin_check
if "%isAdmin%"=="false" (
    goto admin_required
)
if "%choice%"=="6" goto startup_on
if "%choice%"=="7" goto startup_off
if /i "%choice%"=="X" goto eradicate_pm2
goto menu

:install
echo --- 1. Installing backend Node.js dependencies...
call cd backend ^&^& npm install
if %errorLevel% neq 0 (
    echo [ERROR] Failed to install backend Node.js dependencies.
    pause
    goto menu
)
echo.
echo --- 2. Installing PM2 globally...
call npm install pm2 -g
if %errorLevel% neq 0 (
    echo [ERROR] Failed to install PM2 globally.
    pause
    goto menu
)
echo.
echo Installation complete.
pause
goto menu

:start
echo Starting the backend server with PM2...
call pm2 start backend/index.js --name "%PM2_APP_NAME%"
if %errorLevel% neq 0 (
    echo [ERROR] Failed to start the server.
    pause
)
echo.
pause
goto menu

:stop
call pm2 stop "%PM2_APP_NAME%"
goto menu

:restart
call pm2 restart "%PM2_APP_NAME%"
goto menu

:status
call pm2 list
pause
goto menu

:startup_on
echo --- Enabling auto-startup on system reboot ---
call pm2 startup
call pm2 save
echo --- Auto-startup has been configured ---
pause
goto menu

:startup_off
echo --- Disabling auto-startup ---
call pm2 unstartup
echo --- Auto-startup has been disabled ---
pause
goto menu

:eradicate_pm2
echo.
echo =======================================================================
echo           !!! DANGER: COMPLETE PM2 ERADICATION !!!
echo =======================================================================
echo.
echo  This will uninstall PM2, delete all its configurations, and kill
echo  any related processes. This is for a complete fresh start.
echo.
set /p confirm="Are you sure? This cannot be undone. (y/n): "
if /i "%confirm%" neq "y" goto menu

echo.
echo --- Step 1: Terminating all Node.js and PM2 processes...
taskkill /F /IM node.exe /T >nul 2>&1
echo.

echo --- Step 2: Uninstalling PM2 globally...
npm uninstall pm2 -g
echo.

echo --- Step 3: Deleting the PM2 configuration directory...
set "PM2_DIR=%USERPROFILE%\.pm2"
if exist "!PM2_DIR!" (
    rmdir /s /q "!PM2_DIR!"
)
echo.

echo PM2 has been completely removed. Please run option [1] to reinstall.
pause
goto menu

:admin_required
echo.
echo =================================== WARNING ===================================
echo.
echo  This option requires administrator privileges.
echo  Please right-click on 'app.bat' and select 'Run as administrator'.
echo.
echo ===============================================================================
echo.
pause
goto menu