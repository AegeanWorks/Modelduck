@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ModelDuck needs Node.js 20 or newer.
  echo Install it from https://nodejs.org, then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\node-llama-cpp" (
  echo First run: installing ModelDuck's dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Dependency install failed. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

node src\main.js %*
if errorlevel 1 pause
