import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rm, symlink, readdir, rename, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLibrary } from '../server/file-library.mjs';
import { scanNoteFiles } from '../server/file-discovery.mjs';
import { createDemo } from '../src/demo.ts';
import { ensureNotebooks } from '../shared/notebooks.mjs';
import { storedDocumentSchema } from '../shared/backup.mjs';
import { freshTemplateLibrary } from '../shared/writing-templates.mjs';

function document(id = 'fixture-1') { const doc = createDemo(); return ensureNotebooks({ ...doc, id, title: '文件资料库验收', demo: false, library: undefined, kind: 'text', filename: 'test.txt' }); }
async function fixture(t) {
  // Windows runners may expose TEMP through an 8.3 alias. Compare canonical
  // fixture paths with the canonical paths deliberately returned by storage.
  const root = await mkdtemp(join(await realpath(tmpdir()), 'candlelight-files-')); t.after(() => rm(root, { recursive: true, force: true }));
  const options = { profile: join(root, 'profile'), defaultDirectory: join(root, 'Documents', '烛光笔记'), programDirectory: join(root, 'program') };
  await mkdir(options.programDirectory);
  const store = new FileLibrary(options); const command = input => store.command(input);
  return { root, options, store, command, index: async () => JSON.parse(await readFile(join(options.profile, 'library-index.json'), 'utf8')) };
}
test('file library remembers successful import paths across restarts and keeps index small', async t => {
  const f = await fixture(t); const first = await f.command({ action: 'status' });
  assert.equal(first.directory, f.options.defaultDirectory);
  const other = join(f.root, '学期 资料');
  await f.command({ action: 'import', document: document(), directory: other, remember: true, source: { name: 'lecture.txt', data: Buffer.from('SOURCE TEXT').toString('base64') } });
  const index = await f.index(), entry = index.entries[0];
  assert.equal(index.directory, other); assert.ok(JSON.stringify(index).length < 1500); assert.equal(JSON.stringify(index).includes('SOURCE TEXT'), false);
  assert.equal(await readFile(entry.sourcePath, 'utf8'), 'SOURCE TEXT');
  assert.ok((await readFile(entry.notePath, 'utf8')).includes('chapters'));
  const reopened = new FileLibrary(f.options);
  assert.equal((await reopened.command({ action: 'status' })).directory, other);
  assert.equal((await reopened.command({ action: 'list' }))[0].title, '文件资料库验收');
  await reopened.command({ action: 'directory', directory: join(f.root, 'next') });
  assert.equal((await f.index()).entries[0].notePath, entry.notePath);
});
test('import replay after a response or collection failure verifies both note and original without duplicating', async t => {
  const f=await fixture(t), doc=document(), source={name:'test.txt',data:Buffer.from('original').toString('base64')};
  const request={action:'import',document:doc,source};await f.command(request);
  assert.equal((await f.command(request)).verified,true);assert.equal((await f.index()).entries.length,1);
  await assert.rejects(f.command({...request,source:{...source,data:Buffer.from('different').toString('base64')}}),/已存在/);
  await assert.rejects(f.command({...request,document:{...doc,title:'different'}}),/已存在/);
  assert.equal(await readFile((await f.index()).entries[0].sourcePath,'utf8'),'original');
});

test('migration is verified and idempotent without replacing a later edited note', async t => {
  const f = await fixture(t), doc = document();
  await f.command({ action: 'import', document: doc, migration: true, source: { name: 'test.txt', data: Buffer.from('old').toString('base64') } });
  await f.command({ action: 'save', document: { ...doc, title: 'later edit' } });
  assert.equal((await f.command({ action: 'import', document: doc, migration: true })).verified, true);
  assert.equal((await f.command({ action: 'list' }))[0].title, 'later edit');
  await assert.rejects(f.command({ action: 'import', document: { ...doc, title: 'different old version' }, migration: true }), /已存在/);
  assert.equal((await f.index()).entries.length, 1);
});
test('a verified import resumes after a crash before index commit and refuses conflicting files', async t => {
  const f = await fixture(t), doc = storedDocumentSchema.parse(document()); await f.command({ action: 'status' });
  const folder = join(f.options.defaultDirectory, `资料-${doc.id}`); await mkdir(folder);
  await writeFile(join(folder, 'note.candlelight.json'), JSON.stringify(doc)); await writeFile(join(folder, 'source.txt'), 'source');
  const result = await f.command({ action: 'import', document: doc, migration: true, source: { name: 'test.txt', data: Buffer.from('source').toString('base64') } });
  assert.equal(result.verified, true); assert.equal((await f.index()).entries.length, 1);
  const other = storedDocumentSchema.parse(document('other')), otherFolder = join(f.options.defaultDirectory, '资料-other'); await mkdir(otherFolder); await writeFile(join(otherFolder, 'note.candlelight.json'), JSON.stringify({ ...other, title: 'must retain' }));
  await assert.rejects(f.command({ action: 'import', document: other }), /不同笔记/);
  assert.equal(JSON.parse(await readFile(join(otherFolder, 'note.candlelight.json'), 'utf8')).title, 'must retain');
});
test('external deletion is visible, autosave cannot recreate files, and record-only deletion preserves survivors', async t => {
  const f = await fixture(t), doc = document();
  await f.command({ action: 'import', document: doc, source: { name: 'test.txt', data: Buffer.from('source').toString('base64') } });
  const entry = (await f.index()).entries[0];
  await unlink(entry.sourcePath);
  assert.deepEqual((await f.command({ action: 'inspect', id: doc.id })).missing, [entry.sourcePath]);
  assert.equal((await f.command({ action: 'list' }))[0].storageIssue.missing[0], entry.sourcePath);
  await f.command({ action: 'remove', id: doc.id, recordOnly: true });
  assert.equal((await f.command({ action: 'list' })).length, 0);
  assert.ok(await readFile(entry.notePath));
  await assert.rejects(f.command({ action: 'save', document: doc }), /已不存在/);
  const next = document('fixture-2'); await f.command({ action: 'import', document: next });
  const nextEntry = (await f.index()).entries[0]; await unlink(nextEntry.notePath);
  await assert.rejects(f.command({ action: 'save', document: next }), /找不到笔记文件/);
  assert.equal((await f.command({ action: 'list' }))[0].storageIssue.missing[0], nextEntry.notePath);
});
test('deleting in the app removes managed files and index but never the original import file', async t => {
  const f = await fixture(t), doc = document(), original = join(f.root, 'original.txt');
  await writeFile(original, 'original');
  await f.command({ action: 'import', document: doc, source: { name: 'original.txt', data: (await readFile(original)).toString('base64') } });
  const entry = (await f.index()).entries[0];
  await f.command({ action: 'remove', id: doc.id });
  await assert.rejects(readFile(entry.notePath), { code: 'ENOENT' });
  await assert.rejects(readFile(entry.sourcePath), { code: 'ENOENT' });
  assert.equal(await readFile(original, 'utf8'), 'original'); assert.deepEqual((await f.index()).entries, []);
});
test('directory choices cannot place user files under installation/config or follow a junction there', async t => {
  const f = await fixture(t); const original = await f.command({ action: 'status' });
  for (const directory of ['relative', f.options.programDirectory, join(f.options.profile, 'papers')]) await assert.rejects(f.command({ action: 'directory', directory }));
  const link = join(f.root, 'program-link'); await symlink(f.options.programDirectory, link, 'junction');
  await assert.rejects(f.command({ action: 'directory', directory: link }), /不能位于/);
  assert.equal((await f.command({ action: 'status' })).directory, original.directory);
});
test('catalog originals are paired with notes and survive a separate installation without the old catalog', async t => {
  const f = await fixture(t), builtinDirectory = join(f.root, 'builtins'), doc = {...document('builtin'),kind:'pdf',filename:'sample.pdf'};
  await mkdir(builtinDirectory); await writeFile(join(builtinDirectory, 'catalog.json'), JSON.stringify({ documents: [{ id: doc.id, library: { id: 'sample' } }] }));
  await writeFile(join(builtinDirectory, 'sample.pdf'), '%PDF-1.7\nBUNDLED PDF');
  const store = new FileLibrary({ ...f.options, builtinDirectory });
  await store.command({ action: 'save', document: doc });
  const entry = (await f.index()).entries[0]; assert.equal(entry.sourcePath, join(entry.directory,'source.pdf'));assert.equal(entry.builtinId,undefined);
  const other = new FileLibrary({...f.options,profile:join(f.root,'second-install')});
  assert.equal((await other.command({action:'list'}))[0].storageIssue,undefined);
  assert.equal((await other.command({ action: 'file', id: doc.id })).data.toString(), '%PDF-1.7\nBUNDLED PDF');
  await store.command({ action: 'remove', id: doc.id }); assert.equal(await readFile(join(builtinDirectory, 'sample.pdf'), 'utf8'), '%PDF-1.7\nBUNDLED PDF');
});

test('legacy catalog-only originals are repaired without rewriting a notebook and without overwriting existing source files', async t=>{
  const f=await fixture(t),builtinDirectory=join(f.root,'legacy'),doc={...document('legacy-pdf'),kind:'pdf',filename:'paper.pdf'};
  await mkdir(builtinDirectory);await writeFile(join(builtinDirectory,'catalog.json'),JSON.stringify({documents:[{id:doc.id,library:{id:'paper'}}]}));
  const bytes=Buffer.from('%PDF-1.7\noriginal');await writeFile(join(builtinDirectory,'paper.pdf'),bytes);
  await f.command({action:'import',document:doc,migration:true});
  const index=await f.index(),entry=index.entries[0],before=await readFile(entry.notePath);
  entry.sourcePath=null;entry.builtinId='paper';await writeFile(f.store.indexPath,JSON.stringify(index));
  const store=new FileLibrary({...f.options,builtinDirectory});await store.command({action:'status'});
  assert.deepEqual(await readFile(join(entry.directory,'source.pdf')),bytes);assert.deepEqual(await readFile(entry.notePath),before);
  const portable=new FileLibrary({...f.options,profile:join(f.root,'installed')});assert.equal((await portable.command({action:'list'}))[0].storageIssue,undefined);
  assert.deepEqual((await portable.command({action:'file',id:doc.id})).data,bytes);
  await writeFile(join(entry.directory,'source.pdf'),'%PDF-1.7\nuser replacement');
  await store.command({action:'status'});assert.equal(await readFile(join(entry.directory,'source.pdf'),'utf8'),'%PDF-1.7\nuser replacement');
});

test('JSON note backups never masquerade as the original PDF and missing originals remain repairable', async t=>{
  const f=await fixture(t),doc={...document('restored-pdf'),kind:'pdf',filename:'paper.pdf'};
  await f.command({action:'import',document:doc,source:{name:'backup.json',data:Buffer.from(JSON.stringify({format:'reading-tree-v1',document:doc})).toString('base64')}});
  assert.equal((await f.command({action:'list'}))[0].storageIssue.missing.length,1);
  const entry=(await f.index()).entries[0];assert.equal(entry.sourcePath,join(entry.directory,'source.pdf'));
  await f.command({action:'source-restore',id:doc.id,source:{data:Buffer.from('%PDF-1.7\nrestored source').toString('base64')}});
  assert.equal((await f.command({action:'list'}))[0].storageIssue,undefined);
  assert.equal((await f.command({action:'file',id:doc.id})).data.toString(),'%PDF-1.7\nrestored source');
});
test('profile/setup and template revision checks survive browser cleanup and restart', async t => {
  const f = await fixture(t);
  await f.command({ action: 'learner-save', value: { background: 'Test learner', foundations: ['Algebra'], materials: [] }, step: 'complete' });
  const library = freshTemplateLibrary();
  // Exercise compare-and-write directly with two competing valid revisions.
  const next = { ...library, revision: 1 };
  const results = await Promise.allSettled([f.command({ action: 'templates-save', value: next, revision: 0 }), f.command({ action: 'templates-save', value: next, revision: 0 })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const reopened = new FileLibrary(f.options), learner = await reopened.command({ action: 'learner-read' });
  assert.equal(learner.step, null); assert.equal(learner.knowledge.background, 'Test learner');
  assert.equal((await reopened.command({ action: 'templates-read' })).revision, 1);
  assert.equal((await f.index()).entries.length, 0);
});
test('legacy ideal-tree assets migrate with byte verification and conflict protection', async t => {
  const f = await fixture(t), legacy = join(f.root, 'legacy-ideal'); await mkdir(join(legacy, 'assets'), { recursive: true });
  await writeFile(join(legacy, 'assets', 'paper.pdf'), 'paper'); await writeFile(join(legacy, 'job.json'), '{"status":"complete"}');
  const store = new FileLibrary({ ...f.options, legacyIdealDirectory: legacy }); const status = await store.command({ action: 'status' });
  assert.equal(await readFile(join(status.systemDirectory, 'ideal-trees', 'assets', 'paper.pdf'), 'utf8'), 'paper');
  assert.deepEqual(await readdir(legacy), []);
  await writeFile(join(legacy, 'job.json'), 'different');
  await assert.rejects(new FileLibrary({ ...f.options, legacyIdealDirectory: legacy }).command({ action: 'status' }), /不同版本/);
  assert.equal(await readFile(join(legacy, 'job.json'), 'utf8'), 'different');
});

test('a separate installation recovers the shared library without copying notes, profile or credentials', async t => {
  const f = await fixture(t), doc = document();
  await f.command({ action: 'import', document: doc, source: { name: 'test.txt', data: Buffer.from('source').toString('base64') } });
  await f.command({ action: 'learner-save', value: { background: 'Personal profile', foundations: [], materials: [] }, step: 'complete' });
  await writeFile(join(f.options.profile, '.env'), 'DEEPSEEK_API_KEY=TEST_ONLY');
  const original = (await f.index()).entries[0], before = await readFile(original.notePath);
  const preview = await scanNoteFiles(f.options.defaultDirectory);
  assert.deepEqual(Object.keys(preview.notes[0].document).sort(), ['createdAt', 'entryType', 'filename', 'id', 'kind', 'title']);
  assert.equal(preview.notes[0].document.chapters, undefined, 'Scanning must not retain full notebooks in preview memory');
  const next = new FileLibrary({ ...f.options, profile: join(f.root, 'new-install') });
  const found = await next.command({ action: 'list' }); assert.equal(found.length, 1);
  assert.deepEqual(found[0], JSON.parse(JSON.stringify(storedDocumentSchema.parse(doc)))); assert.deepEqual(await readFile(original.notePath), before);
  assert.equal((await next.command({ action: 'inspect', id: doc.id })).notePath, original.notePath);
  assert.equal((await next.command({ action: 'learner-read' })).step, 'profile');
  assert.equal((await next.command({ action: 'file', id: doc.id })).data.toString(), 'source');
  await assert.rejects(readFile(join(f.root, 'new-install/.env')), { code: 'ENOENT' });
});

test('manual discovery previews nested notes, remembers selected roots, and respects removed records across restart', async t => {
  const f = await fixture(t), other = join(f.root, 'another-library'), noteFolder = join(other, 'semester', 'unit'); await mkdir(noteFolder, { recursive: true });
  const note = storedDocumentSchema.parse(document('from-another-install')); await writeFile(join(noteFolder, 'note.candlelight.json'), JSON.stringify(note));
  await writeFile(join(noteFolder, 'source.txt'), 'original');
  const result = await f.command({ action: 'scan', directory: other }); assert.equal(result.items[0].status, 'new'); assert.equal((await f.index()).entries.length, 0);
  await f.command({ action: 'attach', scanId: result.id, keys: [result.items[0].key], remember: true });
  assert.equal((await f.command({ action: 'list' }))[0].title, note.title);
  await f.command({ action: 'remove', id: note.id, recordOnly: true });
  const reopened = new FileLibrary(f.options); assert.deepEqual(await reopened.command({ action: 'list' }), []);
  const restore = await reopened.command({ action: 'scan', directory: other }); assert.equal(restore.items[0].ignored, true);
  await reopened.command({ action: 'attach', scanId: restore.id, keys: [restore.items[0].key] });
  assert.equal((await reopened.command({ action: 'list' })).length, 1);
  const newFolder = join(other, 'later'); await mkdir(newFolder); await writeFile(join(newFolder, 'note.candlelight.json'), JSON.stringify(storedDocumentSchema.parse(document('later'))));
  assert.equal((await new FileLibrary(f.options).command({ action: 'list' })).length, 2);
});

test('moving a complete material folder can relink the old record without rewriting the notebook', async t => {
  const f = await fixture(t), doc = document(); await f.command({ action: 'import', document: doc });
  const old = (await f.index()).entries[0], moved = join(f.root, 'moved'); await rename(old.directory, moved);
  const scan = await f.command({ action: 'scan', directory: moved }); assert.equal(scan.items[0].status, 'moved');
  await f.command({ action: 'attach', scanId: scan.id, keys: [scan.items[0].key] });
  assert.equal((await f.index()).entries.length, 1); assert.equal((await f.command({ action: 'inspect', id: doc.id })).notePath, join(moved, 'note.candlelight.json'));
});

test('duplicate IDs, damaged files and links never overwrite or silently select a conflicting note', async t => {
  const f = await fixture(t); await f.command({ action: 'status' });
  const root = join(f.root, 'discovery'), doc = storedDocumentSchema.parse(document());
  for (const name of ['first', 'second', 'damaged', 'linked']) await mkdir(join(root, name), { recursive: true });
  for (const name of ['first', 'second']) await writeFile(join(root, name, 'note.candlelight.json'), JSON.stringify({ ...doc, title: name }));
  await writeFile(join(root, 'damaged', 'note.candlelight.json'), '{bad');
  await symlink(join(root, 'first'), join(root, 'shortcut'), 'junction');
  await writeFile(join(root, 'linked', 'note.candlelight.json'), JSON.stringify({ ...doc, id: 'linked' }));
  await symlink(join(root, 'first'), join(root, 'linked', 'source.pdf'), 'junction');
  const scan = await f.command({ action: 'scan', directory: root });
  assert.equal(scan.items.length, 2); assert.ok(scan.items.every(item => item.status === 'conflict')); assert.equal(scan.issueCount, 2);
  await assert.rejects(f.command({ action: 'attach', scanId: scan.id, keys: [scan.items[0].key] }), /冲突/);
  assert.equal((await f.index()).entries.length, 0);
  await assert.rejects(f.command({ action: 'scan', directory: f.options.profile }), /不要扫描/);
});

test('discovery confirmation revalidates files and rejects stale or fabricated selections atomically', async t => {
  const f = await fixture(t), root = join(f.root, 'other'); await mkdir(root);
  const path = join(root, 'note.candlelight.json'); await writeFile(path, JSON.stringify(storedDocumentSchema.parse(document())));
  const scan = await f.command({ action: 'scan', directory: root });
  await assert.rejects(f.command({ action: 'attach', scanId: scan.id, keys: ['forged'] }), /本次/);
  await writeFile(path, JSON.stringify(storedDocumentSchema.parse({ ...document(), title: 'edited after scan' })));
  await assert.rejects(f.command({ action: 'attach', scanId: scan.id, keys: [scan.items[0].key] }), /发生了变化/);
  assert.equal((await f.index()).entries.length, 0);
  await assert.rejects(f.command({ action: 'attach', scanId: 'unknown', keys: [] }), /过期/);
});

test('two applications sharing a note detect external edits and serialize simultaneous writes', async t => {
  const f = await fixture(t), doc = document(); await f.command({ action: 'import', document: doc });
  const other = new FileLibrary({ ...f.options, profile: join(f.root, 'other-profile') }); await other.command({ action: 'list' });
  await f.command({ action: 'save', document: { ...doc, title: 'first application edit' } });
  await assert.rejects(other.command({ action: 'save', document: { ...doc, title: 'stale' } }), /其他应用修改/);
  await other.command({ action: 'list' });
  const writes = await Promise.allSettled([f.command({ action: 'save', document: { ...doc, title: 'first' } }), other.command({ action: 'save', document: { ...doc, title: 'second' } })]);
  assert.equal(writes.filter(write => write.status === 'fulfilled').length, 1);
  const entry = (await f.index()).entries[0]; assert.ok(['first', 'second'].includes(JSON.parse(await readFile(entry.notePath)).title));
  assert.equal((await readdir(entry.directory)).includes('.candlelight-write.lock'), false);
});

test('a discovered PDF notebook retains its editions when its old installation has the only original PDF', async t => {
  const f = await fixture(t); await f.command({ action: 'status' });
  const folder = join(f.options.defaultDirectory, 'old-paper'); await mkdir(folder);
  const doc = storedDocumentSchema.parse({ ...document('old-paper'), kind: 'pdf', filename: 'original.pdf' });
  await writeFile(join(folder, 'note.candlelight.json'), JSON.stringify(doc));
  const scan = await f.command({ action: 'scan', directory: folder }); assert.equal(scan.items[0].missingSource, true);
  await f.command({ action: 'attach', scanId: scan.id, keys: [scan.items[0].key] });
  const found = (await f.command({ action: 'list' }))[0]; assert.deepEqual(found.notebooks, JSON.parse(JSON.stringify(doc.notebooks))); assert.deepEqual(found.storageIssue.missing, [join(folder, 'source.pdf')]);
});

test('a crashed writer lock is recovered but a live writer lock keeps the original note intact', async t => {
  const f = await fixture(t), doc = document(); await f.command({ action: 'import', document: doc });
  const entry = (await f.index()).entries[0], lock = join(entry.directory, '.candlelight-write.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'live-test' }));
  await assert.rejects(f.command({ action: 'save', document: { ...doc, title: 'blocked' } }), /另一个应用/);
  assert.equal(JSON.parse(await readFile(entry.notePath)).title, doc.title);
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true, stdio: 'ignore' }); assert.equal(child.status, 0);
  await writeFile(lock, JSON.stringify({ pid: child.pid, token: 'crashed-test' }));
  await f.command({ action: 'save', document: { ...doc, title: 'recovered' } });
  assert.equal(JSON.parse(await readFile(entry.notePath)).title, 'recovered'); await assert.rejects(readFile(lock), { code: 'ENOENT' });
});

test('deletion respects active writers and refuses an externally changed notebook', async t => {
  const f = await fixture(t), doc = document(); await f.command({ action: 'import', document: doc, source: { name: 'test.txt', data: Buffer.from('source').toString('base64') } });
  const entry = (await f.index()).entries[0], lock = join(entry.directory, '.candlelight-write.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'active-writer' }));
  await assert.rejects(f.command({ action: 'remove', id: doc.id }), /另一个应用/);
  assert.equal((await f.index()).entries.length, 1); assert.equal(await readFile(entry.sourcePath, 'utf8'), 'source');
  await unlink(lock);
  const other = new FileLibrary({ ...f.options, profile: join(f.root, 'second-profile') }); await other.command({ action: 'list' });
  await other.command({ action: 'save', document: { ...doc, title: 'newer external edit' } });
  await assert.rejects(f.command({ action: 'remove', id: doc.id }), /其他应用修改/);
  assert.equal(JSON.parse(await readFile(entry.notePath)).title, 'newer external edit'); assert.equal((await f.index()).entries.length, 1);
  await f.command({ action: 'list' }); await f.command({ action: 'remove', id: doc.id });
  await assert.rejects(readFile(entry.notePath), { code: 'ENOENT' }); await assert.rejects(readFile(entry.sourcePath), { code: 'ENOENT' });
  assert.deepEqual((await f.index()).entries, []);
});
