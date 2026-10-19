import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { openSettingsStore, updateEnvText } from '../server/settings-store.mjs';
import { defaultModelConnection } from '../shared/app-settings.mjs';
import { startTestServer } from './support/server.mjs';

test('env updates preserve unrelated comments and multiline values, remove duplicates, and round-trip key characters',()=>{
  const original='# Local settings\r\nPORT=5173\r\nREADING_TREE_PDF_FONT="C:/Chinese font.ttf"\r\nOTHER="first\r\nDEEPSEEK_API_KEY=literal-data\r\nlast"\r\nexport DEEPSEEK_API_KEY="old\r\nmultiline"\r\nDEEPSEEK_API_KEY=duplicate\r\n';
  const settings={...defaultModelConnection,apiKey:`test-#\"$\\secret`,startupMode:'manual'};
  const next=updateEnvText(original,settings),parsed=parseEnv(next);
  assert.equal(parsed.DEEPSEEK_API_KEY,settings.apiKey);assert.equal(parsed.OTHER,parseEnv(original).OTHER);
  assert.equal(parsed.PORT,'5173');assert.equal(parsed.READING_TREE_PDF_FONT,'C:/Chinese font.ttf');assert.ok(next.startsWith('# Local settings\r\n'));
  assert.ok(!next.includes('duplicate'));assert.ok(!next.includes('old\r\nmultiline'));
});

test('saved connection survives restart; omitted keys, serialized updates and write failures preserve state',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pangzhu-settings-')),path=join(directory,'.env');
  try {
    await writeFile(path,'# keep\nPORT=5200\n');
    const store=await openSettingsStore({path,environment:{}});
    assert.equal(store.current.startupMode,'adaptive');
    await store.save({apiKey:'test-persisted',model:'custom-model'});
    await Promise.all([store.save({startupMode:'manual'}),store.save({baseUrl:'https://example.org/v1'})]);
    const reopened=await openSettingsStore({path,environment:{DEEPSEEK_API_KEY:'stale-key',DEEPSEEK_MODEL:'stale-model'}});
    assert.deepEqual(reopened.current,store.current);assert.equal(reopened.current.apiKey,'test-persisted');
    assert.equal(reopened.publicConfig().apiKey,undefined);assert.equal(reopened.publicConfig().startupMode,'manual');
    const failing=await openSettingsStore({path,environment:{},write:async()=>{throw new Error('private path and test-persisted');}});
    await assert.rejects(failing.save({apiKey:'replacement'}),error=>/设置未更改/.test(error.message)&&!error.message.includes('test-persisted'));
    assert.equal(failing.current.apiKey,'test-persisted');
    assert.throws(()=>store.save({apiKey:'abc\nPORT=1'}));assert.throws(()=>store.save({model:'a\nb'}));
    await reopened.reset();const reset=await openSettingsStore({path,environment:{DEEPSEEK_API_KEY:'stale-key'}});
    assert.equal(reset.current.apiKey,'');assert.equal(reset.current.baseUrl,defaultModelConnection.baseUrl);assert.equal(reset.current.startupMode,'manual');
    assert.equal(parseEnv(await readFile(path,'utf8')).PORT,'5200');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('HTTP settings persist without returning the key, draft tests do not save, and reset retains reading startup',async()=>{
  const server=await startTestServer();let restarted;
  try {
    const initial=await (await fetch(server.base+'/api/config')).json();
    const headers={'Content-Type':'application/json','X-Reading-Tree-Token':initial.token};
    const post=async(path,body)=>fetch(server.base+path,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal(initial.startupMode,'adaptive');assert.equal(initial.storage,'env');
    const saved=await post('/api/config',{apiKey:'test-offline-key',model:'persisted-model',startupMode:'manual'});
    const savedBody=await saved.json();assert.equal(saved.status,200);assert.equal(savedBody.apiKey,undefined);
    const envText=await readFile(join(server.directory,'.env'),'utf8');assert.equal(parseEnv(envText).DEEPSEEK_API_KEY,'test-offline-key');
    // A failing draft connection uses a loopback port with no provider. Its
    // supplied key and model must not become the saved configuration.
    const trial=await post('/api/test',{baseUrl:'http://127.0.0.1:1',model:'draft',apiKey:'draft-key'});
    assert.equal(trial.status,400);assert.equal(await readFile(join(server.directory,'.env'),'utf8'),envText);
    restarted=await startTestServer({}, {envText});
    const after=await (await fetch(restarted.base+'/api/config')).json();
    assert.equal(after.model,'persisted-model');assert.equal(after.configured,true);assert.equal(after.startupMode,'manual');assert.equal(after.apiKey,undefined);
    assert.equal((await fetch(server.base+'/api/config/reset',{method:'POST',body:'{}'})).status,403);
    const result=await (await post('/api/config/reset',{})).json();
    assert.equal(result.configured,false);assert.equal(result.model,defaultModelConnection.model);assert.equal(result.startupMode,'manual');
    assert.equal(parseEnv(await readFile(join(server.directory,'.env'),'utf8')).DEEPSEEK_API_KEY,'');
  } finally {await restarted?.stop();await server.stop();}
});
