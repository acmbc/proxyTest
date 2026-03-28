@echo off
title Proxy Server Launcher
setlocal
cd /d "%~dp0"

echo Checking for Bun...
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Bun is not installed. 
    echo Please install it from https://bun.sh
    pause
    exit /b
)

if not exist "node_modules" (
    echo [FIRST RUN] Installing dependencies...
    call bun install consola express http-proxy wisp-server-node vite
)

if not exist "server.ts" (
    echo [ERROR] server.ts was not found in %cd%
    pause
    exit /b
)

echo Starting server...
bun server.ts
pause
