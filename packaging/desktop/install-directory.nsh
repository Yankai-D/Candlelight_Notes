; The upstream directory-page callback appends APP_FILENAME whenever the
; chosen path does not contain today's product name. This nests upgrades of
; older/custom-named installations. Replace only that callback, not the
; installer or its uninstall/update policy.
!include FileFunc.nsh
!macro CandlelightResolveInstallDirectory
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ; An existing application directory is already the exact destination.
  ${Else}
    ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R0 != $INSTDIR
      ${GetFileName} "$INSTDIR" $R1
      ${If} $R1 != "${APP_FILENAME}"
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE candlelightInstFilesPre
  Function candlelightInstFilesPre
    !ifdef allowToChangeInstallationDirectory
      ; Keep the upstream callback referenced (NSIS treats unused functions as
      ; errors). Its only effect is path normalization; restore the selection
      ; before applying the corrected rule below.
      Push $INSTDIR
      Call instFilesPre
      Pop $INSTDIR
    !endif
    !insertmacro CandlelightResolveInstallDirectory
  FunctionEnd
!macroend
