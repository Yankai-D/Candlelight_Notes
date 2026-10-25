; Only a real uninstall clears credentials. electron-builder also invokes the
; old uninstaller during an upgrade, with --updated; preserve settings then.
!include "${__FILEDIR__}\install-directory.nsh"
!ifdef PRODUCT_FILENAME
  !define CANDLELIGHT_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"
  !include "${__FILEDIR__}\app-running.nsh"
  !include "${__FILEDIR__}\installer-handoff.nsh"
  !include "${__FILEDIR__}\installer-upgrade.nsh"
!endif
!ifndef CANDLELIGHT_PROFILE_PATH
  !define CANDLELIGHT_PROFILE_PATH "$APPDATA\PangzhuNotes"
!endif
!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "${CANDLELIGHT_PROFILE_PATH}\.env"
    Delete "${CANDLELIGHT_PROFILE_PATH}\.env.*.tmp"
    ${If} ${FileExists} "${CANDLELIGHT_PROFILE_PATH}\.env"
      MessageBox MB_ICONSTOP|MB_OK "API Key could not be removed. Close Candlelight Notes and retry uninstall."
      Abort
    ${EndIf}
    ${If} ${FileExists} "${CANDLELIGHT_PROFILE_PATH}\.env.*.tmp"
      MessageBox MB_ICONSTOP|MB_OK "Temporary credentials could not be removed. Retry uninstall."
      Abort
    ${EndIf}
    ; Old browser databases survive until the app verifies migration.
    ${If} ${FileExists} "${CANDLELIGHT_PROFILE_PATH}\file-storage-migrated"
      RMDir /r "${CANDLELIGHT_PROFILE_PATH}\browser"
      RMDir /r "${CANDLELIGHT_PROFILE_PATH}\ideal-trees"
    ${EndIf}
    RMDir /r "${CANDLELIGHT_PROFILE_PATH}\logs"
  ${EndIf}
!macroend
