@echo off
set "NODE_PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
set "PORT=5175"
set "HOST=127.0.0.1"
set "CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe"
"%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "%~dp0export-server.js"
