@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1

echo === Mod Browser Carousel: build + deploy ===
echo Project: %ROOT%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%deploy.ps1"
if errorlevel 1 (
    echo.
    echo DEPLOY FAILED.
    pause
    exit /b 1
)

echo.
echo Done. Fully restart Vortex to load the new build.
pause