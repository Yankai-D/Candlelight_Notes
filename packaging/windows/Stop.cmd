@echo off
chcp 65001 >nul
"%~dp0runtime\node.exe" "%~dp0launcher\launch.mjs" --stop
set "PANGZHU_EXIT=%ERRORLEVEL%"
if not "%PANGZHU_EXIT%"=="0" pause
exit /b %PANGZHU_EXIT%
