import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalBridge } from '../desktop/local-bridge.mjs';
import { readLocalJSON } from '../shared/local-api.mjs';
import { preparationInterruption } from '../shared/note-recovery.mjs';
import { prepareDocument } from '../shared/preparation.mjs';
import { createDemo } from '../src/demo.ts';

async function serve(t, handler) {
  const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}
const request=(path,options={})=>new Request('pangzhu://app'+path,options);

test('loopback bridge has a connect-only deadline, waits for headers and body, forwards exact bytes and never replays a POST',async t=>{
  let calls=0,received;
  const address=await serve(t,async(req,res)=>{
    calls++;const parts=[];for await(const chunk of req)parts.push(chunk);received={url:req.url,headers:req.headers,body:Buffer.concat(parts).toString()};
    await delay(100);res.writeHead(200,{'content-type':'application/json'});res.write('{"result":');
    await delay(100);res.end('"完成"}');
  });
  const response=await createLocalBridge(address,{connectTimeout:35})(request('/api/edit?q=1',{method:'POST',headers:{'content-type':'application/json','x-reading-tree-token':'local-only',cookie:'private-cookie',authorization:'do-not-forward',origin:'https://evil.test'},body:'{"text":"中文与𝜃"}'}));
  assert.deepEqual(await readLocalJSON(response),{result:'完成'});assert.equal(calls,1);
  assert.equal(received.url,'/api/edit?q=1');assert.equal(received.body,'{"text":"中文与𝜃"}');
  assert.equal(received.headers['x-reading-tree-token'],'local-only');
  for(const key of ['cookie','authorization','origin'])assert.equal(received.headers[key],undefined);
  assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
});

test('binary, range, empty responses and redirects retain HTTP meaning without following external locations',async t=>{
  const bytes=Buffer.from([0,1,255,42]);let count=0;
  const address=await serve(t,(req,res)=>{count++;
    if(req.url==='/empty'){res.writeHead(204);res.end();return;}
    if(req.url==='/redirect'){res.writeHead(302,{location:'http://external.invalid/'});res.end();return;}
    assert.equal(req.headers.range,'bytes=0-3');res.writeHead(206,{'content-type':'application/pdf','content-range':'bytes 0-3/8'});res.end(bytes);
  });
  const bridge=createLocalBridge(address),response=await bridge(request('/source',{headers:{range:'bytes=0-3'}}));
  assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('content-range'),'bytes 0-3/8');
  assert.equal((await bridge(request('/empty'))).status,204);assert.equal((await bridge(request('/redirect'))).status,302);assert.equal(count,3);
  assert.throws(()=>createLocalBridge('https://example.org'));assert.throws(()=>createLocalBridge(address+'/api'));
  assert.equal((await bridge(new Request('https://evil.test/api/edit'))).status,403);assert.equal(count,3);
  const cross=request('/api/edit');Object.defineProperty(cross,'initiatorOrigin',{value:'https://evil.test'});
  assert.equal((await bridge(cross)).status,403);assert.equal(count,3);
});

test('cancellation closes the active service request before or after headers and never sends a pre-cancelled request',async t=>{
  for(const headersSent of [false,true]){
    let closed,entered;const disconnected=new Promise(resolve=>{closed=resolve}),started=new Promise(resolve=>{entered=resolve});
    const address=await serve(t,(req,res)=>{res.on('close',closed);if(headersSent){res.writeHead(200,{'content-type':'application/json'});res.write(' ');}entered();});
    const controller=new AbortController(),pending=createLocalBridge(address)(request('/api/edit',{method:'POST',body:'{}',signal:controller.signal}));
    await started;const response=headersSent?await pending:null;controller.abort();await disconnected;
    if(headersSent)await assert.rejects(readLocalJSON(response),e=>['AbortError','LOCAL_SERVICE_UNAVAILABLE'].includes(e.name)||e.code==='LOCAL_SERVICE_UNAVAILABLE');
    else assert.equal((await pending).status,499);
  }
  let calls=0;const address=await serve(t,(_req,res)=>{calls++;res.end('{}');});const controller=new AbortController();controller.abort();
  assert.equal((await createLocalBridge(address)(request('/api/edit',{signal:controller.signal}))).status,499);assert.equal(calls,0);
});

test('unavailable services and truncated bodies produce typed local errors, not model JSON errors or leaked raw HTML',async t=>{
  const reports=[];const missing=await createLocalBridge('http://127.0.0.1:1',{report:e=>reports.push(e)})(request('/api/edit',{method:'POST',body:'{}'}));
  assert.equal(missing.status,503);assert.equal(reports.length,1);
  await assert.rejects(readLocalJSON(missing),e=>e.code==='LOCAL_SERVICE_UNAVAILABLE'&&e.recovery.stopRun);
  const address=await serve(t,async(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');await delay(30);res.destroy();});
  await assert.rejects(readLocalJSON(await createLocalBridge(address)(request('/api/edit'))),e=>e.code==='LOCAL_SERVICE_UNAVAILABLE');
  for(const [status,body,code]of [[503,'Local application unavailable','LOCAL_SERVICE_UNAVAILABLE'],[502,'<html>PRIVATE_PROXY_TEXT</html>','LOCAL_SERVICE_UNAVAILABLE'],[200,'<html>PRIVATE_PROXY_TEXT</html>','LOCAL_RESPONSE_INVALID']]){
    await assert.rejects(readLocalJSON(new Response(body,{status})),e=>e.code===code&&!/Unexpected|PRIVATE_PROXY/.test(e.message)&&preparationInterruption(e,1,'c1').code===code);
  }
  await assert.rejects(readLocalJSON(Response.json({error:'已有的领域错误',code:'INVALID_EDIT_FORMAT'},{status:400})),e=>e.code==='INVALID_EDIT_FORMAT'&&e.message==='已有的领域错误');
  assert.equal(await readLocalJSON(Response.json(null)),null);
});

test('a local transport interruption pauses at the affected chapter and continuation preserves earlier accepted chapters',async()=>{
  let current=createDemo();current.demo=false;current.chapters=current.chapters.slice(0,3).map(c=>({...c,status:'empty',content:{type:'doc',content:[]}}));
  const ids=current.chapters.map(c=>c.id),calls=[];
  const common={getLatest:()=>current,save:async value=>{current=value;},settings:{mode:'translation'}};
  await prepareDocument({...common,document:current,request:async(_doc,id)=>{calls.push(id);if(id===ids[1])return readLocalJSON(new Response('Local application unavailable',{status:503}));return {blocks:[{type:'paragraph',text:'已完成正文',sourcePages:[]}]};}});
  assert.deepEqual(calls,ids.slice(0,2));assert.equal(current.preparation.interruption.code,'LOCAL_SERVICE_UNAVAILABLE');
  assert.deepEqual(current.preparation.currentErrorIds,[ids[1]]);assert.equal(current.chapters[2].status,'empty');
  const completed=structuredClone(current.chapters[0]);
  await prepareDocument({...common,document:current,request:async(_doc,id)=>{calls.push(id);return {blocks:[{type:'paragraph',text:'接续正文',sourcePages:[]}]};}});
  assert.deepEqual(calls,[ids[0],ids[1],ids[1],ids[2]]);assert.deepEqual(current.chapters[0],completed);assert.equal(current.preparation.status,'complete');
});
