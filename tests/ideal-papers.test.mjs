import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {IdealRunner,publicJob} from '../server/ideal-tree/runner.mjs';
import {arxivId,parseArxivFeed,parseArxivPage,createArxivSearch} from '../server/ideal-tree/arxiv.mjs';
import {createResearchTools,sourceId} from '../server/ideal-tree/research.mjs';
import {idealNodeResources,idealSourceIdentity,idealCommandSchema} from '../shared/ideal-tree.mjs';
const abstract='We propose a new family of policy gradient methods for reinforcement learning, which alternate between sampling data through interaction with the environment, and optimizing a surrogate objective function using stochastic gradient ascent.';
const source={id:'Sppo',arxivId:'1707.06347v2',title:'Proximal Policy Optimization Algorithms',url:'https://arxiv.org/abs/1707.06347v2',text:abstract,level:'abstract',extent:'arXiv 官方摘要'};
const selection={nodeId:'R1',sourceIds:[source.id],evidence:[{sourceId:source.id,quote:abstract.slice(0,150)}],explanation:'学习策略梯度的更新规则。'};
function fixture() {
  const node={body:'理解策略梯度的更新与稳定性。',outcome:'能够解释策略更新与训练稳定性的关系。',dependsOn:[]};
  return {id:randomUUID(),revision:1,createdAt:Date.now(),updatedAt:Date.now(),input:{goal:'理解强化学习训练',profile:{background:'本科生',foundations:[]},library:[]},status:'complete',stage:'学习路径构建完成',
    skeleton:{branches:[{id:'B1',title:'策略优化'}]},branches:{B1:{branchId:'B1',nodes:[{...node,id:'K1',parentId:null,kind:'knowledge',title:'PPO'},{...node,id:'R1',parentId:'K1',kind:'reading',title:'策略优化论文'},{...node,id:'K2',parentId:null,kind:'knowledge',title:'无关内容'},{...node,id:'P1',parentId:'K1',kind:'practice',title:'练习'}]}},research:{B1:{selections:[selection]}},sources:[source],orientation:[],metrics:{modelCalls:0,toolCalls:0,completionTokens:0,repairs:0},events:[],issues:[],gaps:[],review:{summary:'原有评审'}};
}
async function setup(options={}) {
  const directory=await mkdtemp(join(tmpdir(),'ideal-papers-'));
  const runner=new IdealRunner({directory,tools:{arxiv:async()=>({sources:[source],problems:[]}),asset:async s=>({filename:s.title+'.pdf',data:'PDF'}),paper:async s=>({...s,asset:'S123.pdf'}),...options}});
  const job=fixture(); await runner.store.save(job); return {runner,job};
}
function provider(log=[]) {return async(messages,task)=>{
  const data=JSON.parse(messages[1].content);log.push(task.stage);task.onCompletion?.({completionTokens:20});
  if(task.stage==='paper-plan') return JSON.stringify({query:'proximal policy optimization',arxivIds:['1707.06347']});
  assert.equal(task.stage,'paper-select');
  return JSON.stringify({selections:[{nodeId:data.node.id,sourceIds:[data.sources[0].id],explanation:'摘要明确覆盖该节点的策略优化目标。',evidence:[{sourceId:data.sources[0].id,excerptId:data.sources[0].excerpts[0].id}]}]});
};}
const request=job=>({action:'ideal-tree',command:'papers',id:job.id,branchId:'B1',nodeId:'K1'});
async function finish(runner,id) {await runner.paperActive.get(id)?.promise;return runner.store.read(id);}

test('knowledge resources follow explicit reading relationships, preserve evidence and deduplicate arXiv versions',()=>{
  const job=fixture();assert.equal(idealNodeResources(job,'B1','K1')[0].viaTitle,'策略优化论文');assert.deepEqual(idealNodeResources(job,'B1','K2'),[]);assert.deepEqual(idealNodeResources(job,'B1','P1'),[]);
  job.sources.push({...source,id:'Sother',url:'https://arxiv.org/pdf/1707.06347'});
  job.paperResearch={B1:{K1:{selection:{...selection,nodeId:'K1',sourceIds:['Sother'],evidence:[{sourceId:'Sother',quote:abstract}]}}}};
  const rows=idealNodeResources(job,'B1','K1');assert.equal(rows.length,1);assert.equal(rows[0].sourceId,'Sother');assert.equal(rows[0].quote,abstract);
  assert.equal(idealSourceIdentity(source.url),idealSourceIdentity('https://arxiv.org/pdf/1707.06347.pdf'));
  assert.equal(idealSourceIdentity('https://arxiv.org.evil.test/pdf/1707.06347'),'');
  assert.throws(()=>idealCommandSchema.parse({...request(job),branchId:'../private'}));
});
test('arXiv metadata parser verifies IDs, decodes titles and refuses fake entries/entities',()=>{
  const xml=`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/1707.06347v2</id><title>Policy &amp; Optimization</title><summary>${abstract}</summary><author><name>Author One</name></author><published>2017-07-20</published></entry><entry><id>https://example.org/paper</id><title>Fake</title><summary>${abstract}</summary></entry></feed>`;
  const rows=parseArxivFeed(xml);assert.equal(rows.length,1);assert.equal(rows[0].title,'Policy & Optimization');assert.equal(rows[0].arxivId,'1707.06347v2');assert.deepEqual(rows[0].authors,['Author One']);
  assert.throws(()=>parseArxivFeed('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///secret">]><feed/>'));
  const page=`<meta name="citation_arxiv_id" content="1707.06347"><meta name="citation_title" content="PPO"><blockquote class="abstract">Abstract: ${abstract}</blockquote>`;
  assert.equal(parseArxivPage(page,'1707.06347v2').title,'PPO');assert.throws(()=>parseArxivPage(page,'1506.02438'),/不一致/);
  for(const value of ['https://arxiv.org.evil.org/abs/1707.06347','https://user:pass@arxiv.org/abs/1707.06347','https://127.0.0.1/abs/1707.06347','../../secret']) assert.equal(arxivId(value),null);
});
test('keyword lookup uses the real Atom endpoint, only accepts verified abstracts and caches successes',async()=>{
  const calls=[];
  const search=createArxivSearch(async url=>{calls.push(url);return{bytes:Buffer.from(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/1707.06347v2</id><title>PPO</title><summary>${abstract}</summary></entry></feed>`)}},sourceId);
  const result=await search({query:'proximal policy optimization'});assert.equal(result.sources.length,1);assert.equal(result.sources[0].asset,undefined);
  const url=new URL(calls[0]);assert.equal(url.hostname,'export.arxiv.org');assert.equal(url.searchParams.get('search_query'),'all:"proximal" AND all:"policy" AND all:"optimization"');
  await search({query:'proximal policy optimization'});assert.equal(calls.length,1);
});
test('node research is independent, durable, idempotent and imports verified PDF without rebuilding curriculum',async()=>{
  const {runner,job}=await setup();const log=[];
  const started=await runner.command(request(job),provider(log),'fixture');assert.equal(started.job.paperResearch.B1.K1.status,'running');
  await runner.command(request(job),provider(log),'fixture');const result=await finish(runner,job.id);
  assert.equal(result.paperResearch.B1.K1.status,'complete');assert.deepEqual(result.branches,job.branches);assert.deepEqual(result.research,job.research);assert.deepEqual(result.review,job.review);assert.equal(result.status,'complete');assert.deepEqual(log,['paper-plan','paper-select']);
  assert.equal(result.paperResearch.B1.K1.selection.evidence[0].quote,abstract);assert.equal(publicJob(result).sources[0].text,undefined);
  await runner.command(request(job),provider(log),'fixture');assert.equal(log.length,2);
  const asset=await runner.command({command:'resource',id:job.id,sourceId:source.id});assert.equal(asset.data,'PDF');
  await assert.rejects(runner.command({...request(job),nodeId:'P1'},provider()),/知识与能力/);
  await assert.rejects(runner.command({command:'resource',id:job.id,sourceId:'not-in-tree'}),/不属于/);
});
test('failed refresh preserves recommendations; malformed matches have one bounded format repair and never fabricate sources',async()=>{
  const {runner,job}=await setup();await runner.command(request(job),provider(),'fixture');const previous=await finish(runner,job.id);
  let calls=0;await runner.command({...request(job),refresh:true},async(messages,task)=>{
    calls++;if(task.stage==='paper-plan') return provider()(messages,task);
    return JSON.stringify({selections:[{...selection,nodeId:'K1',sourceIds:['imaginary']}]});
  },'fixture');
  const result=await finish(runner,job.id);assert.equal(calls,3);assert.equal(result.paperResearch.B1.K1.status,'failed');assert.deepEqual(result.paperResearch.B1.K1.selection,previous.paperResearch.B1.K1.selection);assert.deepEqual(result.branches,job.branches);assert.equal(result.sources.length,1);
});
test('paper research can be paused and process interruption does not leave an endless running indicator',async()=>{
  const {runner,job}=await setup();let ready;const begun=new Promise(r=>{ready=r});
  await runner.command(request(job),async(_messages,task)=>{ready();return new Promise((_resolve,reject)=>task.signal.addEventListener('abort',()=>reject(task.signal.reason),{once:true}))},'fixture');await begun;
  await assert.rejects(runner.command({command:'resume',id:job.id},provider()),/论文查找/);
  await runner.command({command:'pause',id:job.id});const stopped=await finish(runner,job.id);assert.equal(stopped.paperResearch.B1.K1.status,'failed');assert.equal(stopped.status,job.status);
  stopped.paperResearch.B1.K1.status='running';await runner.store.save(stopped);
  const fresh=new IdealRunner({store:runner.store});const recovered=await fresh.command({command:'get',id:job.id});assert.equal(recovered.job.paperResearch.B1.K1.status,'failed');assert.match(recovered.job.paperResearch.B1.K1.error,/中断/);
});

test('deleting a tree aborts node paper research before removing the last checkpoint',async()=>{
  const {runner,job}=await setup();let ready;const begun=new Promise(r=>{ready=r});
  await runner.command(request(job),async(_messages,task)=>{ready();return new Promise((_,reject)=>task.signal.addEventListener('abort',()=>reject(task.signal.reason),{once:true}));},'fixture');await begun;
  await runner.command({command:'delete',id:job.id,confirm:true});
  assert.equal(runner.paperActive.size,0);await assert.rejects(runner.store.read(job.id),{code:'ENOENT'});
});
test('PDF import downloads the exact arXiv paper, preserves original bytes/title and rejects HTML masquerading as PDF',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ideal-paper-pdf-'));const doc=await PDFDocument.create();const page=doc.addPage();const font=await doc.embedFont(StandardFonts.Helvetica);page.drawText(abstract,{x:30,y:600,size:10,font,maxWidth:500});const bytes=Buffer.from(await doc.save());let calls=0;
  const tools=createResearchTools(dir,{read:async url=>{calls++;assert.equal(url,'https://arxiv.org/pdf/1707.06347v2');return{url,type:'application/pdf',bytes}}});
  const paper=await tools.paper(source);const asset=await tools.asset(paper);assert.ok(asset.filename.includes(source.title));assert.deepEqual(Buffer.from(asset.data,'base64'),bytes);await tools.paper(source);assert.equal(calls,1);
  const fake=createResearchTools(dir,{read:async url=>({url,type:'text/html',bytes:Buffer.from('<main>'+abstract.repeat(2)+'</main>')})});await assert.rejects(fake.paper(source),/未返回.*PDF/);
});
