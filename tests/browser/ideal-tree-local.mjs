import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testBrowser } from '../support/browser.mjs';
import { startTestServer } from '../support/server.mjs';
import { completeOnboarding } from '../support/onboarding.mjs';
import { IdealStore } from '../../server/ideal-tree/runner.mjs';
import { IDEAL_PROTOCOL, IDEAL_PROMPTS } from '../../shared/ideal-tree.mjs';

const output = process.env.PANGZHU_TEST_OUTPUT;
if (!output) throw new Error('Set an isolated evidence directory.');
await mkdir(output, { recursive: true });
const server = await startTestServer({ READING_TREE_FILE_STORAGE: '1' });
let browser;
const errors = [], commands = [];
try {
  browser = await testBrowser();
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== server.base) return void request.abort();
    if (url.pathname === '/api/edit') commands.push(JSON.parse(request.postData()));
    return void request.continue(); // Exercise the real HTTP schemas, not a mock response.
  });
  const click = async text => {
    for (const button of await page.$$('button')) if (await button.evaluate((el, value) => el.textContent.trim() === value, text)) return button.click();
    throw new Error('Button missing: ' + text);
  };
  const openTree = async () => {
    await page.click('[aria-label="学习树"]');
    const response = page.waitForResponse(r => r.url().endsWith('/api/edit') && JSON.parse(r.request().postData()).command === 'list');
    await click('理想学习树');
    const result = await response; assert.equal(result.status(), 200, await result.text());
    await page.waitForFunction(() => !document.querySelector('.ideal-saved-empty[role="status"]'));
    assert.equal(await page.$('.ideal-tree [role="alert"]'), null);
  };
  await page.goto(server.base); await completeOnboarding(page);
  const config = await (await fetch(server.base + '/api/config')).json(); assert.equal(config.configured, false);
  await openTree(); assert.match(await page.$eval('.ideal-entry', el => el.textContent), /创建第一个目标/);
  await page.screenshot({ path: join(output, 'first-open.png') });
  await click('新的目标'); await page.waitForSelector('#ideal-goal');
  assert.match(await page.$eval('.ideal-goal-footer', el => el.textContent), /连接模型/);
  await page.keyboard.press('Escape');

  const index = JSON.parse(await readFile(join(server.directory, 'profile/library-index.json'), 'utf8'));
  const store = new IdealStore(join(index.systemDirectory, 'ideal-trees'));
  const job = { id: '10000000-0000-4000-8000-000000000001', protocol: IDEAL_PROTOCOL, promptVersion: IDEAL_PROMPTS,
    input: { goal: '学习统计基础并完成练习', profile: { background: '', foundations: [] }, library: [] },
    status: 'paused', stage: '已暂停', model: 'offline-fixture', revision: 1, edition: 1, createdAt: 1, updatedAt: 1,
    branches: {}, research: {}, sources: [], orientation: [], issues: [], events: [], metrics: { modelCalls: 0, toolCalls: 0, completionTokens: 0, repairs: 0 } };
  await store.save(job);
  await page.reload(); await page.waitForSelector('.application-shell'); await openTree();
  await page.waitForSelector('.ideal-saved button'); await page.click('.ideal-saved button');
  await page.waitForSelector('.ideal-toolbar'); assert.equal(await page.$('.ideal-tree [role="alert"]'), null);
  const exported = page.waitForResponse(r => r.url().endsWith('/api/edit') && JSON.parse(r.request().postData()).command === 'export');
  await page.click('[aria-label="导出理想学习树"]');
  const exportResponse = await exported; assert.equal(exportResponse.status(), 200); assert.equal((await exportResponse.json()).result.artifact.id, job.id);
  await click('全部目标'); await page.waitForSelector('.ideal-saved button');
  assert.deepEqual(await store.read(job.id), job, 'Browsing and exporting must preserve the saved tree');
  assert.ok(commands.length >= 4); assert.ok(commands.every(c => c.workspaceToken === config.workspaceToken && ['list', 'get', 'export'].includes(c.command)));
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'pass', actualModelCalls: 0, commands: commands.map(c => c.command), checks: ['first open with no key', 'empty saved goals', 'new goal entry', 'reload saved goals', 'open saved tree', 'export saved tree', 'saved state unchanged'] }, null, 2));
  console.log('PASS: ideal tree first entry and saved goals over real HTTP');
} finally { await browser?.close(); await server.stop(); }
