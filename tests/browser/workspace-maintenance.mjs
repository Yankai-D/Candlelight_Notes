import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { testBrowser } from '../support/browser.mjs';
import { startTestServer } from '../support/server.mjs';
import { createDemo } from '../../src/demo.ts';
import { FileLibrary } from '../../server/file-library.mjs';
import { createGenerationRecord } from '../../server/generation-records.mjs';
import { ensureNotebooks, selectNotebook, commitNotebook } from '../../shared/notebooks.mjs';
import { paragraph, withIds } from '../../shared/document.mjs';

const output = process.env.PANGZHU_TEST_OUTPUT;
if (!output) throw new Error('Set an isolated evidence directory.');
await mkdir(output, { recursive: true });
const server = await startTestServer({ READING_TREE_FILE_STORAGE: '1' });
const browser = await testBrowser(), errors = [], modelCalls = [], started = Date.now();
let page;
try {
  const options = { profile: join(server.directory, 'profile'), defaultDirectory: join(server.directory, 'documents') };
  const store = new FileLibrary(options), original = createDemo(), chapter = original.chapters[0];
  let document = selectNotebook(ensureNotebooks({ ...original, id: 'maintenance-fixture', title: '工程维护样例', demo: false, library: undefined, kind: 'text', filename: 'source.txt', pages: [original.pages[0]], chapters: [chapter], currentChapter: chapter.id, currentPage: 1 }), 'adaptive');
  document = commitNotebook({ ...document, chapters: [{ ...chapter, status: 'ready', content: withIds({ type: 'doc', content: [paragraph('这是一份用于维护验收的原创笔记。')] }) }] });
  await store.command({ action: 'import', document, source: { data: Buffer.from('Original fixture source').toString('base64') } });
  await store.command({ action: 'learner-save', value: { background: 'Browser QA', foundations: [], materials: [] }, step: 'complete' });
  const request = { action: 'generate', scope: 'chapter', instruction: 'Translate', revision: document.revision, documentId: document.id, chapterId: chapter.id, document, learning: { mode: 'translation' } };
  const record = await createGenerationRecord(store.index.systemDirectory, request, 'offline-fixture'); await record.finish('cancelled', undefined, { name: 'AbortError' });
  const indexFile = join(options.profile, 'library-index.json'), index = async () => JSON.parse(await readFile(indexFile, 'utf8'));
  const entry = (await index()).entries[0];
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 960 });
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => { const url = new URL(request.url()); if (url.origin !== server.base) return request.abort(); if (['/api/edit','/api/test'].includes(url.pathname)) { modelCalls.push(url.pathname); return request.abort(); } return request.continue(); });
  const click = async (text, selector = 'button') => { for (const button of await page.$$(selector)) if (await button.evaluate((element, value) => element.textContent.trim() === value, text)) { await button.click(); return; } throw new Error('Button not found: ' + text); };
  const replace = async (selector, value) => { await page.focus(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.type(selector, value); };
  const library = async () => { await page.click('[aria-label="资料库"]'); await page.waitForSelector('[aria-label="打开 工程维护样例"]'); };
  const maintenance = async () => { await page.click('[aria-label="模型设置"]'); await click('资料存储'); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '资料备份与恢复')); await click('资料备份与恢复'); await page.waitForSelector('.maintenance-form'); };
  await page.goto(server.base); await page.waitForSelector('[aria-label="打开 工程维护样例"]');
  await page.click('[aria-label="模型设置"]'); await page.waitForSelector('.connection-fields input[type="password"]');
  await page.type('.connection-fields input[type="password"]', 'LOCAL_FIXTURE_KEY'); await click('保存连接'); await page.waitForSelector('.connection-lock');
  assert.match(await readFile(join(server.directory, '.env'), 'utf8'), /LOCAL_FIXTURE_KEY/);
  await click('清除 Key'); await click('确认清除 Key'); await page.waitForFunction(() => document.querySelector('.provider-status')?.textContent === '未配置');
  assert.doesNotMatch(await readFile(join(server.directory, '.env'), 'utf8'), /LOCAL_FIXTURE_KEY/); await page.click('[aria-label="关闭弹窗"]');
  const sourceBefore = await readFile(entry.sourcePath);
  await page.click('[aria-label="整理 工程维护样例"]'); await click('移除资料'); await click('移入回收站'); await page.waitForSelector('[aria-label="打开 工程维护样例"]', { hidden: true });
  assert.deepEqual(await readFile(entry.sourcePath), sourceBefore); assert.equal((await index()).retired.length, 1);
  await maintenance(); await click('移除记录与回收站'); await page.waitForSelector('.maintenance-retired-item');
  await page.screenshot({ path: join(output, 'recycle-bin.png'), fullPage: true });
  await click('恢复到资料库'); await page.waitForSelector('[aria-label="打开 工程维护样例"]');
  assert.equal((await index()).retired.length, 0);
  await maintenance(); await replace('[aria-label="备份保存位置"]', join(server.directory, 'backup-parent'));
  const backupResponse = page.waitForResponse(response => response.url().endsWith('/api/storage') && response.request().postData()?.includes('workspace-backup'));
  await click('创建完整备份'); const backup = await (await backupResponse).json(); await page.waitForSelector('.maintenance-result[role="status"]');
  const baseline = await readFile(join(backup.directory, 'notes/0/note.candlelight.json'));
  await page.screenshot({ path: join(output, 'backup-complete.png'), fullPage: true });
  await page.click('[aria-label="关闭弹窗"]'); await page.click('[aria-label="打开 工程维护样例"]'); await page.waitForSelector('.tiptap[contenteditable="true"]');
  const heaps = [(await page.metrics()).JSHeapUsedSize];
  // Accelerated lifecycle regression: this is not an hours-long soak claim.
  for (let i = 0; i < 16; i++) {
    await page.click('.tiptap[contenteditable="true"]'); await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control'); await page.keyboard.type(` cycle-${i} `);
    await page.waitForFunction(() => document.querySelector('.save-indicator')?.textContent.includes('已保存到本机'));
    // Require the marker on disk, not just a previous saved indicator.
    for (let attempt = 0; ; attempt++) { if ((await readFile(entry.notePath, 'utf8')).includes(`cycle-${i}`)) break; if (attempt > 30) throw new Error('Save did not persist cycle ' + i); await new Promise(resolve => setTimeout(resolve, 100)); }
    await library(); await page.click('[aria-label="打开 工程维护样例"]'); await page.waitForSelector('.tiptap[contenteditable="true"]');
    if (i % 4 === 3) { await page.reload(); await page.waitForSelector('[aria-label="打开 工程维护样例"]'); await page.click('[aria-label="打开 工程维护样例"]'); await page.waitForSelector('.tiptap[contenteditable="true"]'); }
  }
  heaps.push((await page.metrics()).JSHeapUsedSize);
  await page.click('[aria-label="修改记录"]'); await click('查看生成来源与调用记录'); await page.waitForSelector('.record-row'); await page.click('.record-row'); await page.waitForSelector('.record-detail');
  assert.match(await page.$eval('.record-detail', element => element.textContent), /offline-fixture/);
  await page.screenshot({ path: join(output, 'generation-evidence.png'), fullPage: true }); await page.click('[aria-label="关闭弹窗"]');
  await library(); await maintenance(); await click('恢复空间'); await replace('[aria-label="已有备份文件夹"]', backup.directory); await click('检查备份'); await page.waitForSelector('[aria-label="恢复资料保存位置"]');
  await replace('[aria-label="恢复资料保存位置"]', join(server.directory, 'restored'));
  assert.equal(await page.$$eval('button', elements => elements.find(el => el.textContent.includes('恢复并打开')).disabled), true);
  await page.screenshot({ path: join(output, 'restore-preview.png'), fullPage: true });
  await page.setViewport({ width: 390, height: 844 }); await page.screenshot({ path: join(output, 'restore-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.setViewport({ width: 1440, height: 960 });
  await page.click('.discovery-remember input'); await Promise.all([page.waitForNavigation(), click('恢复并打开')]); await page.waitForSelector('[aria-label="打开 工程维护样例"]');
  const restoredEntry = (await index()).entries[0]; assert.deepEqual(await readFile(restoredEntry.notePath), baseline);
  assert.ok((await readFile(entry.notePath, 'utf8')).includes('cycle-15'));
  await maintenance(); await click('恢复空间'); await Promise.all([page.waitForNavigation(), click('返回上一个学习空间')]); await page.waitForSelector('[aria-label="打开 工程维护样例"]');
  assert.equal((await index()).entries[0].notePath, entry.notePath);
  await unlink(entry.sourcePath); await page.click('[aria-label="打开 工程维护样例"]'); await page.waitForSelector('[aria-label="选择缺失的原文"]');
  const replacement = join(server.directory, 'replacement.txt'); await writeFile(replacement, sourceBefore);
  await (await page.$('[aria-label="选择缺失的原文"]')).uploadFile(replacement); await Promise.all([page.waitForNavigation(), click('确认恢复这份原文')]); await page.waitForSelector('[aria-label="打开 工程维护样例"]'); assert.deepEqual(await readFile(entry.sourcePath), sourceBefore);
  await page.click('[aria-label="打开 工程维护样例"]'); await page.waitForSelector('.tiptap[contenteditable="true"]');
  await page.waitForFunction(() => document.querySelector('.save-indicator')?.textContent.includes('已保存到本机'));
  const external = JSON.parse(await readFile(entry.notePath)); external.title = '另一安装版的修改'; await writeFile(entry.notePath, JSON.stringify(external));
  await page.click('.tiptap[contenteditable="true"]'); await page.keyboard.type('local-conflict-copy');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '处理保存冲突'));
  await click('处理保存冲突'); await page.waitForSelector('.recovery-columns'); await page.screenshot({ path: join(output, 'conflict-preview.png'), fullPage: true });
  await Promise.all([page.waitForNavigation(), click('当前修改另存为新笔记')]); await page.waitForSelector('[aria-label="打开 工程维护样例 · 本地副本"]');
  assert.equal(JSON.parse(await readFile(entry.notePath)).title, '另一安装版的修改');
  const copy = (await index()).entries.find(item => item.id !== document.id); assert.ok((await readFile(copy.notePath, 'utf8')).includes('local-conflict-copy'));
  assert.equal(modelCalls.length, 0); assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'pass', modelCalls: 0, elapsedMs: Date.now() - started, acceleratedCycles: 16, heapSamplesBytes: heaps, heapInterpretation: 'Two diagnostic samples; not a leak or hours-long stability conclusion.', checks: ['recoverable removal preserves originals', 'complete backup and verified preview', 'explicit restore and return to original workspace', 'missing-original relink', 'frozen generation evidence', '16 edit/save/navigation cycles with 4 reloads', 'conflict preview and keep-both copy', 'mobile maintenance layout'] }, null, 2));
  console.log('PASS: workspace maintenance and accelerated lifecycle');
} catch (error) { if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.content()); } throw error; }
finally { await browser.close(); await server.stop(); }
