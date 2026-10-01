' Silent launcher for the desktop shortcut "fin".
'
' PowerShell can only start hidden from a console host with -WindowStyle Hidden,
' which still flashes a window. This wrapper asks WScript to run the real
' launcher with window style 0, so double-clicking the desktop icon shows the
' browser and nothing else. Errors are shown in a message box instead of a
' console that has already been closed.

Option Explicit

Dim shell, fso, here, script, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(here, "start-findeck.ps1")

If Not fso.FileExists(script) Then
  MsgBox "Launcher not found:" & vbCrLf & script, vbCritical, "fin"
  WScript.Quit 1
End If

command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File """ _
  & script & """"

exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
  MsgBox "FinDeck did not start." & vbCrLf & vbCrLf _
    & "Exit code: " & exitCode & vbCrLf _
    & "Logs: %USERPROFILE%\.findeck\logs\web-server.err.log", _
    vbExclamation, "fin"
End If
