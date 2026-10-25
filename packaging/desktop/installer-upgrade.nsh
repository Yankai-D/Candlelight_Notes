!ifndef CANDLELIGHT_INSTALLER_UPGRADE
!define CANDLELIGHT_INSTALLER_UPGRADE
!include FileFunc.nsh
!ifndef CANDLELIGHT_INSTALLER_LOG
  !define CANDLELIGHT_INSTALLER_LOG "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}.log"
!endif

!macro CandlelightUpgradeLog MESSAGE
  System::Store S
  ${GetParent} "${CANDLELIGHT_INSTALLER_LOG}" $R7
  CreateDirectory "$R7"
  ClearErrors
  FileOpen $R8 "${CANDLELIGHT_INSTALLER_LOG}" a
  ${IfNot} ${Errors}
    FileSeek $R8 0 END $R9
    ${If} $R9 > 65536
      FileClose $R8
      FileOpen $R8 "${CANDLELIGHT_INSTALLER_LOG}" w
    ${EndIf}
    FileWriteUTF16LE $R8 "${MESSAGE}$\r$\n"
    FileClose $R8
  ${EndIf}
  System::Store L
!macroend

; Run the CURRENT, bundled uninstaller for upgrades. Calling the installed
; uninstaller would reintroduce its old process detection even after Setup's
; own guard has been fixed. Never replace the installed uninstaller in place.
!macro CandlelightUpgradeInstalledVersion
  System::Store S
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R1 != ""
    ; Require the registered application layout, not just an arbitrary path.
    ${If} $R0 == ""
    ${OrIfNot} ${FileExists} "$R0\${APP_EXECUTABLE_FILENAME}"
    ${OrIfNot} ${FileExists} "$R0\resources\app.asar"
      MessageBox MB_ICONSTOP|MB_OK "原安装目录不完整，无法安全执行覆盖更新。$\r$\n$R0" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    InitPluginsDir
    !insertmacro CandlelightUpgradeLog "upgrade-start: $R0"
    File "/oname=$PLUGINSDIR\candlelight-upgrade.exe" "${UNINSTALLER_OUT_FILE}"
    Delete "$PLUGINSDIR\candlelight-upgrade-error.txt"
    ClearErrors
    ExecWait '"$PLUGINSDIR\candlelight-upgrade.exe" /S /currentuser --updated --keep-shortcuts /candlelight-report="$PLUGINSDIR\candlelight-upgrade-error.txt" _?=$R0' $R2
    ${If} ${Errors}
      StrCpy $R2 "launch-error"
    ${EndIf}
    ${If} $R2 != 0
      StrCpy $R3 "更新程序无法完成旧文件替换（退出码 $R2）。"
      ClearErrors
      FileOpen $R4 "$PLUGINSDIR\candlelight-upgrade-error.txt" r
      ${IfNot} ${Errors}
        FileReadUTF16LE $R4 $R3
        FileClose $R4
      ${EndIf}
      !insertmacro CandlelightUpgradeLog "upgrade-failed ($R2): $R3"
      MessageBox MB_ICONSTOP|MB_OK "$R3$\r$\n原安装目录：$R0$\r$\n更新已停止，未开始写入新版本。$\r$\n诊断记录：${CANDLELIGHT_INSTALLER_LOG}" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    ; A failed registry removal must not fall through to the upstream legacy
    ; uninstaller, which would silently reintroduce its process detection.
    ReadRegStr $R4 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${If} $R4 != ""
      !insertmacro CandlelightUpgradeLog "upgrade-failed: old uninstall registration remains"
      MessageBox MB_ICONSTOP|MB_OK "无法更新旧版本的安装记录，请检查注册表写入权限。$\r$\n诊断记录：${CANDLELIGHT_INSTALLER_LOG}" /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    !insertmacro CandlelightUpgradeLog "upgrade-cleanup-complete: $R0"
  ${EndIf}
  System::Store L
!macroend

!ifdef BUILD_UNINSTALLER
  ; Same move-and-restore transaction as electron-builder, but retain the
  ; actual failed path instead of turning every failure into "app running".
  ; Source: electron-builder templates/nsis/uninstaller.nsh (MIT).
  !macro customRemoveFiles
    ${If} ${isUpdated}
      CreateDirectory "$PLUGINSDIR\old-install"
      Push ""
      Call un.atomicRMDir
      Pop $R0
      ${If} $R0 != 0
        StrCpy $R6 $R0
        Push ""
        Call un.restoreFiles
        Pop $R0
        ${GetParameters} $R1
        ClearErrors
        ${GetOptions} $R1 "/candlelight-report=" $R2
        ${IfNot} ${Errors}
          FileOpen $R3 "$R2" w
          FileWriteUTF16LE $R3 "无法替换文件：$R6。已尝试还原原版本，请检查该文件是否被占用或是否有写入权限。"
          FileClose $R3
        ${EndIf}
        SetErrorLevel 2
        Abort "Failed to replace: $R6"
      ${EndIf}
    ${EndIf}
    SetOutPath $TEMP
    RMDir /r "$INSTDIR"
  !macroend
!endif
!endif
