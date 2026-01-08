@echo off
echo Starting Ultimate Ping Pong LAN Server...
echo.
echo Make sure you have the 'websockets' package installed.
echo If not, run: .venv\Scripts\pip install -r requirements.txt
echo.
.venv\Scripts\python.exe server.py
pause
