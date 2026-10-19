import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { publicSourcePath, auditPublicText, publicRecord } from '../packaging/source/policy.mjs';
import { preparePublicMaterials } from '../scripts/prepare-public-materials.mjs';
import { startTestServer } from './support/server.mjs';

test('public source boundary rejects secrets, personal state, extra materials and traversal', () => {
  for (const name of ['.env.example','server/index.mjs','tests/fixtures/paper.mjs','materials/descriptive-statistics/01-selected-reading.pdf']) assert.equal(publicSourcePath(name), true);
  for (const name of ['.env','.env.backup','server/.env','../src/a.ts','src/../../a.ts','src\\a.ts','C:/a.ts','src//a.ts','.git/config','output/log.json','src/note.candlelight.json','materials/private.pdf','src/key.pem']) assert.throws(() => publicSourcePath(name));
  assert.throws(() => auditPublicText('sk-' + 'a'.repeat(32)));
  assert.throws(() => auditPublicText('secret-value', 'secret-value'));
  assert.throws(() => auditPublicText('C:' + '/Users/' + 'sample'));
  assert.doesNotThrow(() => auditPublicText('DEEPSEEK_API_KEY=\n'));
  const record = { validation: { tests: 338 }, selfUse: { configured: true }, previous: [{ selfUse: { processId: 1 }, status: 'pass' }] };
  assert.deepEqual(publicRecord(record), { validation: { tests: 338 }, previous: [{ status: 'pass' }] });
  assert.ok(record.selfUse);
});

test('public materials are hash-bound, idempotent and never overwrite a changed catalog', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'candlelight-public-'));
  t.after(async () => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  await mkdir(join(directory, 'examples/course/descriptive-statistics'), { recursive: true });
  await cp('examples/course/descriptive-statistics/sources.json', join(directory, 'examples/course/descriptive-statistics/sources.json'));
  await cp('materials', join(directory, 'materials'), { recursive: true });
  const first = await preparePublicMaterials(directory), catalogPath = join(first.library, 'catalog.json');
  const catalog = await readFile(catalogPath); assert.equal(JSON.parse(catalog).documents.length, 3);
  assert.deepEqual(await preparePublicMaterials(directory), first); assert.deepEqual(await readFile(catalogPath), catalog);
  await writeFile(catalogPath, '{"documents":[{"id":"personal-note"}]}');
  await assert.rejects(preparePublicMaterials(directory), /preserved/);
  assert.equal(await readFile(catalogPath, 'utf8'), '{"documents":[{"id":"personal-note"}]}');
  await writeFile(catalogPath, catalog);
  await writeFile(join(directory, 'materials/descriptive-statistics/01-selected-reading.pdf'), 'changed');
  await assert.rejects(preparePublicMaterials(directory), /checksum mismatch/);
  assert.deepEqual(await readFile(catalogPath), catalog);
});

test('public source startup serves only the three approved examples with isolated empty settings', async t => {
  const server = await startTestServer({ READING_TREE_FILE_STORAGE: '1' }, { entry: 'scripts/start-public.mjs' });
  t.after(() => server.stop());
  const config = await (await fetch(server.base + '/api/config')).json(); assert.equal(config.configured, false);
  const catalog = await (await fetch(server.base + '/api/library')).json();
  assert.deepEqual(catalog.documents.map(d => d.library.id).sort(), ['descriptive-statistics-categorical','descriptive-statistics-numerical','descriptive-statistics-textbook']);
  for (const document of catalog.documents) {
    assert.equal(document.versions.length, 0); assert.ok(document.chapters.every(c => c.status === 'empty'));
    const source = await fetch(server.base + `/api/library/${document.library.id}/source`);
    assert.equal(source.status, 200); assert.equal(Buffer.from(await source.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  }
});
