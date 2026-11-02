@echo off
echo.
echo ========================================
echo   Singularity Pack - Dev Server
echo ========================================
echo.
echo Starting server on all network interfaces...
echo.

cd /d "%~dp0"
npm run dev

pause
