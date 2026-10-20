import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions,selectUpdate,checkForUpdate} from '../desktop/updates.mjs';
const repo='https://github.com/Yankai-D/Candlelight_Notes';
function release(v,extra={}){const name=`Candlelight-Notes-${v}-Setup-x64.exe`;return {tag_name:`v${v}`,html_url:`${repo}/releases/tag/v${v}`,published_at:'2026-10-20',draft:false,prerelease:false,assets:[{name,state:'uploaded',browser_download_url:`${repo}/releases/download/v${v}/${name}`}],...extra}}
test('updates compare numeric versions and prereleases, ignore drafts, older versions and unrelated assets',()=>{
 assert.equal(compareVersions('0.1.19','0.1.9'),1);assert.equal(compareVersions('1.0.0','1.0.0-beta.4'),1);assert.equal(compareVersions('1.0.0-beta.10','1.0.0-beta.2'),1);
 assert.equal(selectUpdate([release('0.1.18')],'0.1.18'),null);
 assert.equal(selectUpdate([release('0.1.20',{draft:true}),release('0.1.19',{prerelease:true})],'0.1.18').version,'0.1.19');
 assert.equal(selectUpdate([release('1.0.1',{prerelease:true})],'1.0.0'),null);
 assert.equal(selectUpdate([release('0.1.20',{html_url:'https://evil.invalid'}),release('0.1.19',{assets:[]})],'0.1.18'),null);
});
test('update requests are bounded, public and independent of model credentials; network failure is explicit to caller',async()=>{
 let calls=0;
 const next=await checkForUpdate('0.1.18',{fetcher:async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'api.github.com');assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(JSON.stringify([release('0.1.19')]))}});
 assert.equal(next.version,'0.1.19');assert.equal(calls,1);
 await assert.rejects(checkForUpdate('0.1.18',{fetcher:async()=>new Response('',{status:403})}),/读取/);
 await assert.rejects(checkForUpdate('0.1.18',{fetcher:async()=>new Response('x'.repeat(2*1024*1024+1))}),/限制/);
});
