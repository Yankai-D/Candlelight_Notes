import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from 'puppeteer-core';
import electron from 'electron';
import { noteBlocks } from '../shared/note-format.mjs';
import { defaultCourseSample } from '../shared/course-style.mjs';
import { brand } from '../shared/brand.mjs';
import { brandMarkPaths } from '../shared/brand-mark.mjs';
import { completeOnboarding } from '../tests/support/onboarding.mjs';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { docxFixture, pptxFixture, htmlFixture } from '../tests/support/office-fixtures.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  previous: { type: 'string' }, out: { type: 'string' }, visible: { type: 'boolean' },
} });
const target = resolve(positionals[0] || 'output/desktop/dev-01/payload/app');
const packaged = target.endsWith('.exe');
const previous = values.previous ? resolve(values.previous) : null;
if (previous && (!previous.endsWith('.exe') || !packaged || previous === target)) throw new Error('Upgrade verification requires two distinct packaged executables');
const visible = values.visible;
const output = resolve(values.out || 'artifacts/desktop');
if (!output.startsWith(resolve('artifacts') + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Desktop evidence must be under artifacts');
await mkdir(dirname(output), { recursive: true }); await mkdir(output, { recursive: !values.out });
const scratch = await mkdtemp(join(tmpdir(), 'pangzhu-desktop-验收 '));
const profile = join(scratch, '阅读数据');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|pathext|comspec|systemroot|windir|temp|tmp|localappdata|appdata|userprofile|programfiles|programfiles\(x86\)|programdata|lang)$/i.test(key)));
let child, browser, logs = '', address;
const checks = [], pass = text => { checks.push(text); console.log(`PASS: ${text}`); };
async function verifyMaterialWorker(page) {
  const inputs=[['lecture.docx',docxFixture()],['lecture.pptx',pptxFixture()],['lecture.html',htmlFixture()]].map(([name,bytes])=>({name,data:bytes.toString('base64')}));
  const results=await page.evaluate(async inputs=>{
    const config=await (await fetch('/api/config')).json(),results=[];
    for(const input of inputs){const response=await fetch('/api/import/material',{method:'POST',headers:{'content-type':'application/json','x-reading-tree-token':config.token},body:JSON.stringify(input)});if(!response.ok)throw new Error(await response.text());results.push(await response.json());}return results;
  },inputs);
  assert.ok(results.every(result=>result.sections.length===2));assert.equal(results[0].sections[0].title,'中文概率讲义');assert.match(results[1].sections[0].title,/第一张/);assert.equal(results[2].sections[1].title,'期望');
  pass('Packaged worker parses DOCX, PPTX and HTML without a model key or external resources');
}
async function packagedBuild(application) {
  const archive = join(dirname(application), 'resources/app.asar');
  const { extractFile } = await import('@electron/asar');
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  return { version: metadata.version, asarSha256: createHash('sha256').update(await readFile(archive)).digest('hex') };
}
async function deadline(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function screenshot(page, name) {
  if (!visible) return;
  const cdp = await page.createCDPSession();
  try { const image = await cdp.send('Page.captureScreenshot', { fromSurface: false }); await writeFile(join(output, name), Buffer.from(image.data, 'base64')); }
  finally { await cdp.detach(); }
}
async function launch(application = target) {
  const probe = createServer(); await new Promise(resolveReady => probe.listen(0, '127.0.0.1', resolveReady));
  const port = probe.address().port; await new Promise(resolveClose => probe.close(resolveClose));
  child = spawn(packaged ? application : electron, [...(packaged ? [] : [application]), '--diagnostics', ...(!visible ? ['--hidden'] : []), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { env: { ...environment, DEEPSEEK_API_KEY: 'PRIVATE_PARENT_CANARY', READING_TREE_ENV_FILE: join(scratch, 'private.env') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { logs += chunk; if (String(chunk).includes('[desktop]')) console.log(String(chunk).trim()); const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) address = match[0]; });
  child.stderr.on('data', chunk => { logs += chunk; });
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) throw new Error(`Desktop exited early: ${logs.slice(-8000)}`);
    try { browser = await connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null, protocolTimeout: 45000 }); break; } catch { await delay(250); }
  }
  assert.ok(browser, logs.slice(-8000));
  let page;
  for (let i = 0; i < 120; i++) {
    page = (await browser.pages()).find(page => page.url().startsWith('pangzhu://app'));
    if (page) break;
    await delay(250);
  }
  assert.ok(page, `No application window: ${logs.slice(-8000)}`);
  page.on('console', message => { if (message.type() === 'error') logs += `\nRenderer: ${message.text()}`; });
  page.on('pageerror', error => { logs += `\nPage error: ${error.message}`; });
  if (await completeOnboarding(page)) pass('First entry offers a blank user-authored profile and skippable model setup');
  await page.waitForSelector('.collection-row', { timeout: 30000 });
  return page;
}
async function closeWindow(page) {
  const closed = once(child, 'exit');
  const exit = await deadline((async () => { await browser.close(); return closed; })(), 25000, 'Closing the window did not exit the desktop application');
  assert.equal(exit[0], 0); browser.disconnect(); browser = null; child = null;
  await assert.rejects(fetch(address, { signal: AbortSignal.timeout(1000) }));
}
try {
  const targetBuild = packaged ? await packagedBuild(target) : null;
  const previousBuild = previous ? await packagedBuild(previous) : null;
  if (previous) {
    assert.notEqual(previousBuild.version, targetBuild.version, 'Upgrade verification requires distinct application versions');
    assert.notEqual(previousBuild.asarSha256, targetBuild.asarSha256);
  }
  await writeFile(join(scratch, 'private.env'), 'DEEPSEEK_API_KEY=PRIVATE_FILE_CANARY\n');
  let page = await launch(previous || target);
  assert.equal(await page.title(), brand.windowTitle);
  assert.deepEqual(await page.$$eval('.brand-mark svg path', paths => paths.map(path => path.getAttribute('d'))), [...brandMarkPaths]);
  pass('Packaged application uses the canonical candle mark');
  assert.equal(await page.$eval('.collection-brand small', element => element.textContent), brand.englishName);
  await page.click('[aria-label="使用指南"]');
  await page.click('[data-help-topic="about"]');
  await page.waitForSelector('.help-introduction');
  assert.deepEqual(await page.$$eval('.help-introduction p', paragraphs => paragraphs.map(p => p.textContent)), [...brand.introduction]);
  assert.equal(await page.$eval('.help-content>a', link => link.href), brand.projectUrl);
  await page.click('.help-acknowledgements summary');
  assert.ok(await page.$eval('.help-acknowledgements', element => element.open && element.textContent.includes('OpenIntro')));
  await page.click('[aria-label="关闭弹窗"]');
  pass('Project introduction, author link and expandable acknowledgements are present in the packaged application');
  const initial = await page.evaluate(async () => (await fetch('/api/config')).json());
  assert.equal(initial.configured, false); assert.equal(await page.$$eval('.collection-row', rows => rows.length), 3);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.pangzhuDesktop?.onCloseRequest), 'function');
  await screenshot(page, 'library.png');
  pass('Native window, private application origin, isolated settings, three public materials and sandboxed renderer');
  if(!previous)await verifyMaterialWorker(page);

  const firstTarget = previous || target;
  const duplicate = spawn(packaged ? firstTarget : electron, [...(packaged ? [] : [firstTarget]), `--user-data-dir=${profile}`], { env: environment, windowsHide: true, stdio: 'ignore' });
  const duplicateExit = await deadline(once(duplicate, 'exit'), 15000, 'Second instance did not exit').catch(error => { duplicate.kill(); throw error; });
  assert.equal(duplicateExit[0], 0); assert.equal((await browser.pages()).filter(page => page.url().startsWith('pangzhu://app')).length, 1);
  pass('Repeated launch returns to the same application window');

  await page.click('[aria-label="打开 描述性统计 · 教材"]');
  await page.waitForFunction(() => document.querySelector('.source-context-viewport canvas')?.width > 100 && !document.querySelector('.source-context-viewport .source-loading'));
  await page.waitForSelector('.tiptap');
  await screenshot(page, 'reader.png');
  const printed = await page.evaluate(async paragraphs => {
    const config = await (await fetch('/api/config')).json();
    const { documents } = await (await fetch('/api/library')).json();
    const document = documents[0]; document.chapters = [{ ...document.chapters[0], title: '描述性统计公式验收', content: { type: 'doc', content: paragraphs } }];
    const response = await fetch('/api/export/pdf', { method: 'POST', headers: { 'content-type': 'application/json', 'x-reading-tree-token': config.token }, body: JSON.stringify({ document }) });
    if (!response.ok) throw new Error(await response.text());
    return [...new Uint8Array(await response.arrayBuffer())];
  }, defaultCourseSample.paragraphs.flatMap(paragraph => noteBlocks(paragraph.text)));
  const bytes = Buffer.from(printed); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  await writeFile(join(output, 'native-export.pdf'), bytes);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try { const pdf = await task.promise; const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(''); assert.match(text, /描述性统计/); assert.doesNotMatch(text, /\\frac|\\sum/); } finally { await task.destroy(); }
  pass('Embedded reader and Chinese/math PDF export work without an external browser');

  await page.evaluate(async () => {
    const config = await (await fetch('/api/config')).json();
    const response = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json', 'x-reading-tree-token': config.token },
      body: JSON.stringify({ apiKey: 'DESKTOP_QA_ONLY', baseUrl: 'http://127.0.0.1:9', startupMode: 'manual' }) });
    if (!response.ok) throw new Error(await response.text());
  });
  const marker = '桌面退出前的即时编辑已保存';
  await page.evaluate(text => {
    const editor = document.querySelector('.tiptap'); editor.focus(); document.execCommand('insertText', false, text);
  }, marker);
  await closeWindow(page);
  pass('Window close flushes a pending edit and stops the internal service');
  page = await launch();
  await page.click('[aria-label="打开 描述性统计 · 教材"]');
  await page.waitForSelector('.startup-choice');
  await page.click('.startup-choice button:nth-child(2)');
  await page.waitForFunction(text => document.querySelector('.continuous-article')?.textContent.includes(text), {}, marker);
  const upgraded = await page.evaluate(async () => (await fetch('/api/config')).json());
  assert.equal(upgraded.configured, true); assert.equal(upgraded.startupMode, 'manual');
  // Opening an unfinished notebook can start preparation against the deliberately
  // unreachable local test provider. Wait for that attempt and the reading-anchor
  // save to settle; otherwise the app correctly asks whether to pause before exit.
  // The first close above still verifies flushing an immediate, unsaved edit.
  await page.waitForFunction(() => !document.querySelector('.preparation-banner .spin, .ai-composer.is-busy') && document.querySelector('.save-indicator')?.textContent === '已保存到本机');
  if (previous) { pass('New packaged application opens the previous version’s profile and preserves the edited note and saved model settings'); await verifyMaterialWorker(page); }
  await closeWindow(page);
  page = await launch();
  const saved = await page.evaluate(async () => (await fetch('/api/config')).json());
  assert.equal(saved.configured, true); assert.equal(saved.startupMode, 'manual');
  assert.match(await readFile(join(profile, '.env'), 'utf8'), /DESKTOP_QA_ONLY/);
  assert.equal(await readFile(join(scratch, 'private.env'), 'utf8'), 'DEEPSEEK_API_KEY=PRIVATE_FILE_CANARY\n');
  await closeWindow(page);
  pass('Notes and model settings survive repeated restarts; the parent configuration remains untouched');
  if (packaged) assert.deepEqual(await packagedBuild(target), targetBuild, 'Target package changed during verification');
  if (previous) assert.deepEqual(await packagedBuild(previous), previousBuild, 'Previous package changed during verification');
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'pass', target, packaged, previous,
    targetBuild, previousBuild, firstLaunch: previous || target,
    scope: previous ? 'First-version native smoke, then target-version data/settings persistence across two restarts; excludes NSIS installation, shortcuts and uninstall' : 'Native application smoke test',
    checkedAt: new Date().toISOString(), modelCalls: 0, checks }, null, 2) + '\n');
} catch (error) {
  const startup = await readFile(join(profile, 'logs/startup-error.log'), 'utf8').catch(() => '');
  await writeFile(join(output, 'failure.log'), `${error.stack}\n${logs.slice(-16000)}\n${startup}\n`);
  if (browser) for (const page of await browser.pages()) if (page.url().startsWith('pangzhu://app')) await screenshot(page, 'failure.png').catch(() => {});
  throw error;
} finally {
  browser?.disconnect(); if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir())); assert.ok(basename(scratch).startsWith('pangzhu-desktop-'));
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
