import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { appOrigin, isAppURL, externalURL, rendererOptions, contentSecurityPolicy } from './policy.mjs';
import { renderDesktopPDF } from './pdf.mjs';
import { brand } from '../shared/brand.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
app.setName(brand.englishName);
app.setAppUserModelId('org.pangzhu.notes');
const data = resolve(app.commandLine.getSwitchValue('user-data-dir') || join(app.getPath('appData'), 'PangzhuNotes'));
mkdirSync(join(data, 'browser'), { recursive: true });
app.setPath('userData', data); app.setPath('sessionData', join(data, 'browser'));
app.commandLine.appendSwitch('disable-background-networking');
protocol.registerSchemesAsPrivileged([
  { scheme: 'pangzhu', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'pangzhu-print', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
let window, service, allowQuit = false, exitInProgress = false;
const trace = message => { if (app.commandLine.hasSwitch('diagnostics')) console.log(`[desktop] ${message}`); };
const pending = new Map();
ipcMain.on('pangzhu:close-result', (event, value) => {
  trace('Renderer answered close request');
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppURL(event.senderFrame.url)) return;
  const request = pending.get(value?.id); if (!request) return;
  clearTimeout(request.timer); pending.delete(value.id);
  value.ok ? request.resolve(value.result) : request.reject(new Error(String(value.error).slice(0, 300)));
});
function rendererRequest(phase) {
  return new Promise((resolveRequest, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('阅读窗口暂时没有响应，尚未确认笔记保存。')); }, 15000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    window.webContents.send('pangzhu:close-request', { id, phase });
  });
}
async function quitSafely() {
  if (exitInProgress || allowQuit) return;
  exitInProgress = true;
  trace('Preparing to close');
  try {
    const status = await rendererRequest('status');
    trace(`Activity: renderer=${!!status.busy}, service=${service.serviceActivity()}`);
    if (status.busy || service.serviceActivity()) {
      const choice = await dialog.showMessageBox(window, { type: 'question', title: `退出${brand.name}`,
        message: '当前还有进行中的任务或待确认的修改。', detail: '退出会暂停任务，保留已写入的笔记。尚未确认写入的 AI 建议不会保存；下次打开可继续未完成的整理。',
        buttons: ['继续学习', '保存并退出'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response !== 1) return;
    }
    await service.pauseServiceWork();
    trace('Background tasks paused');
    await rendererRequest('save');
    trace('Renderer data saved');
    session.defaultSession.flushStorageData();
    await service.shutdownService();
    trace('Internal service stopped');
    allowQuit = true; app.quit();
  } catch (error) {
    trace(`Close deferred: ${error.message}`);
    await dialog.showMessageBox(window, { type: 'warning', title: '暂未退出', message: '笔记尚未确认保存，已保留阅读窗口。',
      detail: `${error.message}\n请稍后重试，或先导出笔记。`, buttons: ['返回阅读'] });
  } finally { exitInProgress = false; }
}
function openExternal(value) { const url = externalURL(value); if (url) void shell.openExternal(url); }
function menu() {
  return Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '导入资料…', accelerator: 'CmdOrCtrl+O', click: () => window.webContents.send('pangzhu:import') },
      { type: 'separator' }, { label: `退出${brand.name}`, accelerator: 'Alt+F4', click: () => void quitSafely() },
    ] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
    { label: '帮助', submenu: [
      { label: '使用说明', accelerator: 'F1', click: () => window.webContents.send('pangzhu:help') },
      { label: '打开本机数据目录', click: () => void shell.openPath(data) },
      { label: '作者与项目', click: () => openExternal(brand.projectUrl) },
      { type: 'separator' }, { label: `关于${brand.name}`, click: () => void dialog.showMessageBox(window, { title: brand.windowTitle, message: `${brand.windowTitle} ${app.getVersion()}`,
        detail: `${brand.englishName}\n\n${brand.introduction.join('\n\n')}\n\n作者：${brand.authorName}\n${brand.projectUrl}\n\n描述性统计示例来源：OpenIntro。作者、许可与修改说明随资料附带。`, buttons: ['关闭'] }) },
    ] },
  ]);
}
async function start() {
  await app.whenReady();
  await mkdir(join(data, 'logs'), { recursive: true });
  // Personal settings are read only from this application's directory.
  for (const key of Object.keys(process.env)) if (/^(DEEPSEEK_|READING_TREE_)/i.test(key)) delete process.env[key];
  Object.assign(process.env, { PORT: '0', READING_TREE_DESKTOP: '1', READING_TREE_ENV_FILE: join(data, '.env'),
    READING_TREE_STORAGE_PROFILE_DIR: data,
    READING_TREE_STORAGE_DIR: app.commandLine.hasSwitch('user-data-dir') ? join(data, '../资料库') : join(app.getPath('documents'), '烛光笔记'),
    READING_TREE_PROGRAM_DIR: app.isPackaged ? dirname(app.getPath('exe')) : root,
    READING_TREE_LIBRARY_DIR: app.isPackaged ? join(process.resourcesPath, 'materials') : join(root, '../materials'),
    READING_TREE_IDEAL_DIR: join(data, 'ideal-trees'), READING_TREE_DIAGNOSTIC_DIR: join(data, 'logs'), READING_TREE_STATIC_DIR: join(root, 'dist') });
  service = await import('../server/index.mjs');
  service.setPDFRenderer(renderDesktopPDF);
  const address = await service.serviceReady;
  protocol.handle('pangzhu', async request => {
    if (!isAppURL(request.url) || (request.initiatorOrigin && request.initiatorOrigin !== appOrigin)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url), headers = new Headers();
    for (const name of ['content-type', 'x-reading-tree-token', 'range']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    try {
      const response = await fetch(address + url.pathname + url.search, { method: request.method, headers, signal: request.signal,
        ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}) });
      const resultHeaders = new Headers(response.headers); resultHeaders.set('content-security-policy', contentSecurityPolicy);
      return new Response(response.body, { status: response.status, headers: resultHeaders });
    } catch { return new Response('Local application unavailable', { status: 503 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: '导出学习笔记', defaultPath: join(app.getPath('downloads'), item.getFilename()) });
  });
  window = new BrowserWindow({ title: brand.windowTitle, width: 1440, height: 960, minWidth: 1000, minHeight: 700, show: false,
    backgroundColor: '#f9f8f4', icon: join(root, 'desktop/icon.png'), webPreferences: rendererOptions(join(root, 'desktop/preload.cjs')) });
  ipcMain.handle('pangzhu:choose-library-directory', async (event, current) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppURL(event.senderFrame.url)) throw new Error('不允许访问文件夹选择器。');
    const result = await dialog.showOpenDialog(window, { title: '选择资料与笔记保存位置', defaultPath: typeof current === 'string' ? current : app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  Menu.setApplicationMenu(menu());
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppURL(url)) { event.preventDefault(); openExternal(url); } });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => { if (!allowQuit) { event.preventDefault(); void quitSafely(); } });
  await window.loadURL(appOrigin + '/');
  if (!app.commandLine.hasSwitch('hidden')) window.show();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window && !app.commandLine.hasSwitch('hidden')) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => { if (!allowQuit && window) { event.preventDefault(); void quitSafely(); } });
  app.on('window-all-closed', () => { if (allowQuit) app.quit(); });
  void start().catch(async error => {
    await writeFile(join(data, 'logs/startup-error.log'), `${new Date().toISOString()} ${error.stack}\n`).catch(() => {});
    dialog.showErrorBox(`${brand.name}暂时无法打开`, `启动没有完成。个人资料仍保留在本机。\n\n${error.message}\n\n数据目录：${data}`);
    await service?.shutdownService().catch(() => {}); app.exit(1);
  });
}
