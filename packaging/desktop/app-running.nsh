!ifndef CANDLELIGHT_APP_RUNNING
!define CANDLELIGHT_APP_RUNNING
!include LogicLib.nsh

; NSIS is 32-bit, but the application is 64-bit. QueryFullProcessImageNameW
; works across that boundary with PROCESS_QUERY_LIMITED_INFORMATION. Never
; infer identity from a directory prefix or kill every process with a name.
; https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew
Var CandlelightAppPid
Var CandlelightAppPath
!ifdef BUILD_UNINSTALLER
  !define CANDLELIGHT_PROCESS_FUNCTION "un.CandlelightFindApp"
!else
  !define CANDLELIGHT_PROCESS_FUNCTION "CandlelightFindApp"
!endif
Function ${CANDLELIGHT_PROCESS_FUNCTION}
  System::Store S
  StrCpy $CandlelightAppPid 0
  GetFullPathName $CandlelightAppPath "$INSTDIR\${CANDLELIGHT_EXECUTABLE_FILENAME}"
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.r0'
  ${If} $0 == -1
    StrCpy $CandlelightAppPid -1
    Goto candlelight_process_done
  ${EndIf}
  System::Alloc 556
  Pop $1
  ${If} $1 == 0
    StrCpy $CandlelightAppPid -1
    Goto candlelight_snapshot_done
  ${EndIf}
  System::Call '*$1(i 556)'
  System::Call 'kernel32::Process32FirstW(p r0, p r1) i.r2'
  candlelight_process_next:
    ${If} $2 == 0
      Goto candlelight_entries_done
    ${EndIf}
    ; PROCESSENTRY32W: 9 DWORDs/pointers in a 32-bit NSIS process, then name.
    System::Call '*$1(i, i, i.r3, p, i, i, i, i, i, &w260.r4)'
    ${If} $4 == "${CANDLELIGHT_EXECUTABLE_FILENAME}"
      System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r3) p.r5'
      ${If} $5 != 0
        System::Call 'kernel32::QueryFullProcessImageNameW(p r5, i 0, w .r6, *i ${NSIS_MAX_STRLEN}) i.r7'
        System::Call 'kernel32::CloseHandle(p r5)'
        ${If} $7 != 0
          GetFullPathName $6 "$6"
          ${If} $6 == $CandlelightAppPath
            StrCpy $CandlelightAppPid $3
            Goto candlelight_entries_done
          ${EndIf}
        ${Else}
          StrCpy $CandlelightAppPid -1
        ${EndIf}
      ${Else}
        System::Call 'kernel32::GetLastError() i.r7'
        ; A process can exit between enumeration and OpenProcess (87).
        ${If} $7 != 87
          StrCpy $CandlelightAppPid -1
        ${EndIf}
      ${EndIf}
    ${EndIf}
    System::Call 'kernel32::Process32NextW(p r0, p r1) i.r2'
    Goto candlelight_process_next
  candlelight_entries_done:
  System::Free $1
  candlelight_snapshot_done:
  System::Call 'kernel32::CloseHandle(p r0)'
  candlelight_process_done:
  System::Store L
FunctionEnd

!macro customCheckAppRunning
  ; Allow Chromium helpers from a just-closed window to exit. Do not force-kill
  ; the main process: the application's close flow saves notes and checkpoints.
  System::Call 'kernel32::GetTickCount() i.R9'
  candlelight_wait_for_app:
    Call ${CANDLELIGHT_PROCESS_FUNCTION}
    ${If} $CandlelightAppPid == 0
      Goto candlelight_app_closed
    ${EndIf}
    System::Call 'kernel32::GetTickCount() i.R8'
    IntOp $R8 $R8 - $R9
    ${If} $CandlelightAppPid > 0
    ${AndIf} $R8 < 3000
      Sleep 300
      Goto candlelight_wait_for_app
    ${EndIf}
    ${If} $CandlelightAppPid == -1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法核对应用进程的完整路径。请确认权限后重试。$\r$\n$CandlelightAppPath" /SD IDCANCEL IDRETRY candlelight_wait_for_app
    ${Else}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "此位置的烛光笔记仍有进程（PID $CandlelightAppPid）。请在应用中保存并退出，再点击重试。$\r$\n$CandlelightAppPath" /SD IDCANCEL IDRETRY candlelight_wait_for_app
    ${EndIf}
    SetErrorLevel 2
    Quit
  candlelight_app_closed:
  !ifndef BUILD_UNINSTALLER
    !ifmacrodef CandlelightUpgradeInstalledVersion
      !insertmacro CandlelightUpgradeInstalledVersion
    !endif
  !endif
!macroend
!endif
