<#
.SYNOPSIS
  Starts linecast desktop when you sign in to Windows.

.DESCRIPTION
  Puts a shortcut in your Startup folder that runs Start-Linecast-Desktop.bat
  in a minimized window. Run it again with different -Arguments to change
  the options, or with -Remove to take the shortcut away.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Install-Startup.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Install-Startup.ps1 -Arguments '--lan --location "Portland, Maine"'
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Install-Startup.ps1 -Remove
#>
param(
  [string]$Arguments = "",
  [switch]$Remove
)

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'linecast desktop.lnk'

if ($Remove) {
  if (Test-Path $link) { Remove-Item $link; "Removed $link" } else { "Nothing to remove." }
  return
}

$bat = Join-Path $PSScriptRoot 'Start-Linecast-Desktop.bat'
if (-not (Test-Path $bat)) { throw "Cannot find $bat" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $bat
$shortcut.Arguments = $Arguments
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7   # minimized
$shortcut.Description = 'linecast desktop: weather, sun, moon, tides and sky'
$shortcut.Save()
"linecast desktop will start when you sign in. Shortcut: $link"
