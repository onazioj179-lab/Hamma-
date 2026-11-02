@echo off
cd /d "%~dp0.."
if errorlevel 1 exit /b 1
call npm run build:mobile-web
if errorlevel 1 exit /b 1
if not exist target\release\spk-server.exe (
    echo Backend binary missing. Run: cargo build --release -p spk-backend
    exit /b 1
)
echo ================================
echo  Singularity Pack Mobile Web
echo ================================
echo.
echo Starting backend server...
start "Backend" cmd /c "target\release\spk-server.exe"
timeout /t 3 /nobreak >nul

echo Starting mobile web server...
start "Mobile Web" cmd /c "cd mobile-web && python serve.py"
timeout /t 2 /nobreak >nul

echo.
echo ✅ All services started!
echo.
echo 📱 Mobile Web: http://localhost:8080
echo 🧠 Backend API: http://localhost:3000
echo.
echo Services are running in their own windows. Close those windows to stop them.
