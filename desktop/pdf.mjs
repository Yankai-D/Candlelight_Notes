import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { printHTML } from '../server/print-document.mjs';
import { freezePrintLayout } from '../shared/print-layout.mjs';

async function timed(promise, stage, milliseconds = 15000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`PDF 导出在${stage}时超时，请稍后重试。`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export async function renderDesktopPDF(document, options) {
  const printSession = session.fromPartition(`print-${randomUUID()}`, { cache: false });
  const html = await timed(printHTML(document, options), '准备内容');
  printSession.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  printSession.setPermissionCheckHandler(() => false);
  printSession.protocol.handle('pangzhu-print', request => request.url === 'pangzhu-print://document/'
    ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:" } })
    : new Response('Not found', { status: 404 }));
  const window = new BrowserWindow({ show: false, useContentSize: true, width: Math.ceil(options.viewportWidth), height: 1000,
    webPreferences: { session: printSession, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await timed(window.loadURL('pangzhu-print://document/'), '加载页面');
    window.webContents.debugger.attach('1.3');
    await timed(window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'screen' }), '设置打印样式');
    await timed(window.webContents.executeJavaScript('document.fonts.ready.then(() => true)'), '加载字体');
    await timed(window.webContents.executeJavaScript(`(${freezePrintLayout.toString()})()`), '整理排版');
    const height = await timed(window.webContents.executeJavaScript('document.fonts.ready.then(() => Math.ceil(document.querySelector("article").getBoundingClientRect().height))'), '测量页面');
    const pageHeight = Math.min(18000, Math.max(400, height + 2));
    if (height > pageHeight) await window.webContents.insertCSS('@page{margin:32px 0}');
    return await timed(window.webContents.printToPDF({ pageSize: { width: options.articleWidth / 96, height: pageHeight / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }, printBackground: true, displayHeaderFooter: false, scale: 1, preferCSSPageSize: false }), '生成文件', 30000);
  } finally {
    window.destroy(); printSession.protocol.unhandle('pangzhu-print');
  }
}
