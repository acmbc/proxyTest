@echo off
title Proxy Server Launcher
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

echo Starting server...
call bun server.ts
pause
