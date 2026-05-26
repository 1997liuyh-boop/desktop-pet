@echo off
chcp 65001 >nul
echo ================================
echo     桌面宠物系统 - 小橘
echo ================================
echo.
echo 正在启动桌面宠物...
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo 首次运行，正在安装依赖...
    npm install
    echo.
)

:: Start the app
npm start

pause
