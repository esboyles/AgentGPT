@echo off
rem Starts linecast desktop and opens it in its own window.
rem
rem Any options you give are passed on, for example:
rem   Start-Linecast-Desktop.bat --location "Portland, Maine" --imperial
rem   Start-Linecast-Desktop.bat --lan          (let Home Assistant reach it)
rem   Start-Linecast-Desktop.bat --view moon    (one card in a small window)
rem
rem Keep this window open while you use it; closing it stops the server.
setlocal
set "ROOT=%~dp0.."

where uv >nul 2>nul
if %errorlevel%==0 (
  uv run --project "%ROOT%" linecast-desktop --open %*
  goto :end
)

rem No uv: use Python itself, with a private environment of our own.
set "VENV=%LOCALAPPDATA%\linecast-desktop\venv"
if not exist "%VENV%\Scripts\python.exe" (
  where py >nul 2>nul
  if errorlevel 1 (
    echo linecast desktop needs Python 3.10 or newer, or uv.
    echo The quickest fix is:  winget install astral-sh.uv
    goto :fail
  )
  echo Setting up linecast desktop for the first time...
  py -3 -m venv "%VENV%" || goto :fail
)
"%VENV%\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check "%ROOT%" || goto :fail
"%VENV%\Scripts\python.exe" -m linecast_desktop --open %*
goto :end

:fail
echo.
echo linecast desktop could not start. See the messages above.
pause
exit /b 1

:end
endlocal
