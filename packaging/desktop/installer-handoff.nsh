!ifndef CANDLELIGHT_INSTALLER_HANDOFF
!define CANDLELIGHT_INSTALLER_HANDOFF
!include FileFunc.nsh
!ifndef CANDLELIGHT_INSTALLER_CACHE
  !define CANDLELIGHT_INSTALLER_CACHE "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
!endif

; Older uninstallers match *all* processes below their installation prefix.
; If Setup itself is there, hand off before the installer mutex is acquired.
; Reuse electron-builder's existing installer cache, not personal data paths.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/candlelight-parent=" $R1
    ${IfNot} ${Errors}
      System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i R1) p.R2'
      ${If} $R2 != 0
        System::Call 'kernel32::WaitForSingleObject(p R2, i 10000) i.R3'
        System::Call 'kernel32::CloseHandle(p R2)'
        ${If} $R3 != 0
          MessageBox MB_OK|MB_ICONSTOP "原安装进程尚未退出。请关闭旧安装窗口后重试。" /SD IDOK
          SetErrorLevel 2
          Quit
        ${EndIf}
      ${EndIf}
    ${EndIf}
    SetRegView 64
    ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    SetRegView lastused
    ${If} $R1 != ""
      ; Match the legacy predicate, including its missing path boundary.
      StrLen $R2 $R1
      StrCpy $R3 $EXEPATH $R2
      ${If} $R3 == $R1
        ; The cache file need not exist yet. NSIS GetFullPathName can return
        ; empty for a missing leaf; LOCALAPPDATA already supplies a full path.
        StrCpy $R4 "${CANDLELIGHT_INSTALLER_CACHE}"
        ${If} $R4 != $EXEPATH
          StrCpy $R3 $R4 $R2
          ${If} $R3 == $R1
            MessageBox MB_OK|MB_ICONSTOP "请把安装包移到原安装目录以外再运行，旧版卸载器无法在此目录内升级。" /SD IDOK
            SetErrorLevel 2
            Quit
          ${EndIf}
          ${GetParent} "$R4" $R5
          CreateDirectory "$R5"
          ClearErrors
          CopyFiles /SILENT "$EXEPATH" "$R4"
          ${If} ${Errors}
            MessageBox MB_OK|MB_ICONSTOP "无法准备更新缓存。请将安装包移到下载文件夹后重试。" /SD IDOK
            SetErrorLevel 2
            Quit
          ${EndIf}
          System::Call 'kernel32::GetCurrentProcessId() i.R6'
          ClearErrors
          ; NSIS consumes /D before GetParameters, so forward its parsed value
          ; separately, as the final unquoted argument required by NSIS.
          ${If} $INSTDIR != ""
            Exec '"$R4" /candlelight-parent=$R6 $R0 /D=$INSTDIR'
          ${Else}
            Exec '"$R4" /candlelight-parent=$R6 $R0'
          ${EndIf}
          ${If} ${Errors}
            SetErrorLevel 2
          ${Else}
            SetErrorLevel 0
          ${EndIf}
          Quit
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !endif
!macroend
!endif
