import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from 'puppeteer-core';
import { printHTML } from './print-document.mjs';
import { freezePrintLayout } from '../shared/print-layout.mjs';

export function browserPath() {
  const candidates = [
    process.env.READING_TREE_PDF_BROWSER,
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(root => [join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe')]),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  const executablePath = candidates.find(existsSync);
  if (!executablePath) throw new Error('PDF 导出需要本机 Chrome 或 Edge，也可通过 READING_TREE_PDF_BROWSER 指定浏览器路径。');
  return executablePath;
}

// Each export has an isolated, temporary browser profile. It never visits the
// app or a remote URL, so it cannot access saved notes, cookies or model keys.
export async function openPrintPage(document, { fontSize = 17, articleWidth = 920, viewportWidth = 1440, theme = 'sage' } = {}) {
  const options = {
    theme,
    fontSize: Math.max(12, Math.min(24, fontSize)),
    articleWidth: Math.max(280, Math.min(1920, articleWidth)),
    viewportWidth: Math.max(320, Math.min(7680, viewportWidth)),
  };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|localappdata|userprofile|home|lang|display|xdg_runtime_dir)$/i.test(key)));
  const browser = await launch({ executablePath: browserPath(), headless: true, pipe: true, env, timeout: 30000, args: ['--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: Math.ceil(options.viewportWidth), height: 1000, deviceScaleFactor: 1 });
    await page.emulateMediaType('screen');
    await page.setRequestInterception(true);
    page.on('request', request => { void (request.url().startsWith('data:') ? request.continue() : request.abort()); });
    await page.setContent(await printHTML(document, options), { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    // Printing changes CSS's viewport to the paper width even when screen media
    // is emulated. Resolve responsive rules now, using the reader's viewport.
    await page.evaluate(freezePrintLayout);
    await page.evaluate(() => document.fonts.ready);
    return { browser, page, options };
  } catch (error) { await browser.close(); throw error; }
}

export async function renderLearningPDF(document, options = {}) {
  const { browser, page, options: layout } = await openPrintPage(document, options);
  try {
    const height = await page.evaluate(() => Math.ceil(document.querySelector('article').getBoundingClientRect().height));
    // Stay below the portable PDF page limit. Chromium handles overflow at text
    // lines and block boundaries; no image slicing, glyph positioning or scaling.
    const pageHeight = Math.min(18000, Math.max(400, height + 2));
    if (height > pageHeight) await page.addStyleTag({ content: '@page{margin:32px 0}' });
    return Buffer.from(await page.pdf({ width: `${layout.articleWidth}px`, height: `${pageHeight}px`, printBackground: true, displayHeaderFooter: false, scale: 1, preferCSSPageSize: false, timeout: 60000 }));
  } finally { await browser.close(); }
}
