@echo off
chcp 65001 >nul
echo ================================
echo     桌面宠物系统 - 小橘
echo ================================
echo.

cd /d "%~dp0src-tauri"

set "RUSTUP_HOME=C:\Users\Administrator\.rustup"
set "CARGO_HOME=C:\Users\Administrator\.cargo"
set "PATH=C:\Users\Administrator\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;%CARGO_HOME%\bin;%PATH%"

echo [1/2] 编译 Rust 后端...
cargo build 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 编译失败，请检查上方错误信息
    pause
    exit /b 1
)

cd /d "%~dp0"
echo.
echo [2/2] 启动 Tauri 开发服务器...
set "PATH=C:\Users\Administrator\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin;%CARGO_HOME%\bin;%PATH%"
npm run tauri dev
pause