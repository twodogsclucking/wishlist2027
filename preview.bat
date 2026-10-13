@echo off
rem Double-click to preview the site on this computer (with photo upload). Close the window to stop.
cd /d "%~dp0"
where python >nul 2>nul && (python scripts\preview_server.py & goto :eof)
where py >nul 2>nul && (py scripts\preview_server.py & goto :eof)
echo Python was not found. Install it from https://www.python.org/downloads/ and try again.
pause
