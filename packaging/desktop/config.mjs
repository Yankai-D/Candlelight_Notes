import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from '../../shared/brand.mjs';
export function desktopBuildConfig(stage, output) {
  return {
    appId: 'org.pangzhu.notes', productName: brand.windowTitle,
    directories: { app: join(stage, 'app'), output },
    electronVersion: '44.9.0', npmRebuild: false, asar: true, compression: 'normal',
    files: ['**/*'], extraResources: [
      { from: join(stage, 'materials'), to: 'materials' },
      { from: join(stage, 'THIRD-PARTY-NOTICES.txt'), to: 'THIRD-PARTY-NOTICES.txt' },
      { from: join(stage, 'ACKNOWLEDGEMENTS.md'), to: 'ACKNOWLEDGEMENTS.md' },
      { from: join(stage, '使用说明.txt'), to: '使用说明.txt' },
      { from: join(stage, 'PACKAGE-MANIFEST.json'), to: 'PACKAGE-MANIFEST.json' },
    ],
    electronLanguages: ['zh-CN', 'en-US'],
    electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, grantFileProtocolExtraPrivileges: false },
    win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: join(stage, 'app/desktop/icon.ico'),
      executableName: 'PangzhuNotes', signExecutable: false, requestedExecutionLevel: 'asInvoker' },
    artifactName: 'Candlelight-Notes-${version}-Setup-${arch}.${ext}',
    nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
      include: fileURLToPath(new URL('./uninstall.nsh', import.meta.url)),
      createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: brand.windowTitle,
      uninstallDisplayName: brand.windowTitle, deleteAppDataOnUninstall: false, runAfterFinish: true,
      installerLanguages: ['zh_CN', 'en_US'], language: '2052' },
    publish: null,
  };
}
