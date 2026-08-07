@echo off
REM Launches the inbox watcher using this project's virtualenv.
REM Double-click this file, or point a Task Scheduler action at it.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
    echo Virtualenv not found. Run setup first: see README.md "Installation".
    pause
    exit /b 1
)
.venv\Scripts\python.exe -m app.main watch
