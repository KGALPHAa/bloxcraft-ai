@echo off
chcp 65001 >nul
title BloxCraft AI - Roblox Studio Bridge
color 0B

echo ===================================================================
echo             BLOXCRAFT AI - ROBLOX STUDIO LOCAL BRIDGE
echo ===================================================================
echo.
echo  Questo bridge permette al sito web di BloxCraft AI:
echo  https://kgalphaa.github.io/bloxcraft-ai/
echo  di comunicare DIRETTAMENTE con Roblox Studio sul tuo computer!
echo.
echo ===================================================================

cd /d "%~dp0"

:: 1. Prova con Node.js o agy-node
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [i] Avvio tramite Node.js...
    node bridge.js
    goto end
)

if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
    echo [i] Avvio tramite Antigravity Node Runtime...
    call "%APPDATA%\Antigravity\bin\agy-node.cmd" bridge.js
    goto end
)

:: 2. Fallback trasparente su PowerShell (presente su tutti i Windows)
echo [i] Avvio tramite Windows PowerShell...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge.ps1"

:end
pause
