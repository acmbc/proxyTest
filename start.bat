@echo off
cd %~dp0
node server.js
start http://localhost:3003
pause