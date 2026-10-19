import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { claimCases, claimOracles, simulatedClaimReply } from '../evals/claims/cases.mjs';
import { planClaims, runClaims, inspectClaims, claimsHTML } from '../evals/claims/experiment.mjs';
import { fingerprint, normalizeSnapshot, buildClaimReviewMessages, buildClaimPatchMessages, validateClaimReview, validateClaimPatch, previewClaimPatch, runClaimReview } from '../server/claim-review.mjs';

const probe=id=>structuredClone(claimCases.find(c=>c.id===id));
const first=()=>probe('shrink-observed');
const config={model:'test-model',apiKey:'CLAIM_SECRET_SENTINEL',baseUrl:'https://api.deepseek.com'};
const response=(content,finish='stop',usage={prompt_tokens:12,completion_tokens:20})=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:typeof content==='string'?content:JSON.stringify(content)}}],...(usage?{usage}:{})}));
const reviewFor=c=>validateClaimReview(c.snapshot,simulatedClaimReply(c,'review'));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12);

test('condition probes retain the real faulty paragraph, exact text and source; oracle labels stay out of provider context',()=>{
  assert.equal(claimCases.length,8);assert.equal(first().provenance.kind,'real-model-output');
  for(const c of claimCases){
    assert.deepEqual(normalizeSnapshot(c.snapshot),c.snapshot);
    assert.equal(reviewFor(c).checks[0].verdict,c.expected);
    const sentinel=structuredClone(c);sentinel.reference.reason='PRIVATE_ORACLE_SENTINEL';sentinel.expected='PRIVATE_ORACLE_SENTINEL';
    assert.ok(!JSON.stringify(buildClaimReviewMessages(sentinel.snapshot)).includes('PRIVATE_ORACLE_SENTINEL'));
    assert.deepEqual(JSON.parse(buildClaimReviewMessages(c.snapshot)[1].content),c.snapshot);
  }
  const spaced=first().snapshot;spaced.blocks[0].text='  '+spaced.blocks[0].text+'  ';
  assert.equal(normalizeSnapshot(spaced).blocks[0].text,spaced.blocks[0].text);
  const tooLong=first().snapshot;tooLong.source[0].text='x'.repeat(30000);tooLong.blocks[0].text='x'.repeat(20000);
  assert.throws(()=>normalizeSnapshot(tooLong),/exceeds/);
});

test('numeric counterexamples cover zero and nonzero decay, zero offset, and realized errors despite halved SE',()=>{
  for(const c of claimOracles.shrink) {
    assert.ok(c.eta>0&&c.rho>=0&&c.p.every(p=>p>0)&&c.p.some(p=>p!==1));
    const a=c.u.map((u,i)=>(1-c.eta*c.rho)*u-c.eta*c.p[i]*c.h[i]);
    const b=c.u.map((u,i)=>u-c.eta*c.p[i]*(c.h[i]+c.rho*u));
    a.forEach((v,i)=>{close(v,b[i]);close(v,c.expected[i]);});
  }
  assert.ok(claimOracles.shrink.some(c=>c.rho>0&&c.u.some(u=>u!==0)));
  const {x,b,c,expected}=claimOracles.affine;assert.notEqual(c,1);assert.equal(c*(x+b),expected);assert.equal(c*x+b,expected);
  const o=claimOracles.sampling,mu=o.population.reduce((n,v,i)=>n+v*o.probabilities[i],0);
  const variance=o.population.reduce((n,v,i)=>n+(v-mu)**2*o.probabilities[i],0);
  close(Math.sqrt(variance/o.sizes[1]),Math.sqrt(variance/o.sizes[0])/2);
  for(const n of o.sizes){
    const values=Array(n).fill(o.observedValue);close(Math.abs(values.reduce((a,b)=>a+b)/n-mu),o.absoluteError);
    assert.ok(.5**n>0); // Each all-ones sample has positive probability.
  }
});

test('review rejects invented quotes, wrong source pages, foreign spans, missing targets and contradictory verdict fields',()=>{
  const c=first(),raw=()=>simulatedClaimReply(c,'review');
  for(const change of [r=>r.checks[0].evidence[0].quote='invented quote',r=>r.checks[0].evidence[0].page=99,
    r=>r.checks[0].claim='not in paragraph',r=>r.checks[0].blockId='context-1',r=>r.checks.push({...r.checks[0]}),
    r=>r.checks[0].counterexample='',r=>r.checks[0].missingContext='missing',r=>r.checks[0].extra=true]) {
    const r=raw();change(r);assert.throws(()=>validateClaimReview(c.snapshot,r));
  }
  const multi=structuredClone(c.snapshot);multi.targetIds.push('context-1');
  assert.throws(()=>validateClaimReview(multi,raw()),/cover/);
  const wrongPage=structuredClone(c.snapshot);wrongPage.source.push({number:2,text:c.reference.quote});
  const r=raw();r.checks[0].evidence[0].page=2;assert.throws(()=>validateClaimReview(wrongPage,r),/target pages/);
});

test('exact local patch preserves surrounding paragraphs and metadata, compiles formulas, and leaves input untouched',()=>{
  const c=first(),original=structuredClone(c.snapshot),review=reviewFor(c);
  const proposal=validateClaimPatch(c.snapshot,review,simulatedClaimReply(c,'patch'));
  const preview=previewClaimPatch(c.snapshot,review,proposal);
  assert.deepEqual(c.snapshot,original);assert.equal(proposal.semanticStatus,'model-proposal-unverified');
  assert.deepEqual(preview.blocks.slice(0,-1),c.snapshot.blocks.slice(0,-1));assert.deepEqual(preview.source,c.snapshot.source);
  assert.equal(preview.revision,c.snapshot.revision);
  assert.equal(preview.blocks.at(-1).text,c.snapshot.blocks.at(-1).text.replace(c.reference.claim,c.reference.after));
  assert.ok(preview.blocks.at(-1).text.includes('u_{\\text{new}}'));
  const serialized=JSON.stringify(buildClaimPatchMessages(c.snapshot,review));assert.ok(serialized.includes('reading-tree-note-v1'));
});

test('patches reject scope expansion, malformed math, duplicate claim locations and implicit surrounding normalization',()=>{
  const c=first(),review=reviewFor(c),raw=()=>simulatedClaimReply(c,'patch');
  for(const change of [p=>p.edits[0].blockId='context-1',p=>p.edits[0].before=c.snapshot.blocks.at(-1).text,
    p=>p.edits.push({...p.edits[0]}),p=>p.edits[0].after=String.raw`错误 \(\frac{a}{b\)`]) {
    const p=raw();change(p);assert.throws(()=>validateClaimPatch(c.snapshot,review,p));
  }
  const repeated=first();repeated.snapshot.blocks.at(-1).text+=' '+repeated.reference.claim;
  assert.throws(()=>validateClaimPatch(repeated.snapshot,reviewFor(repeated),simulatedClaimReply(repeated,'patch')),/ambiguous/);
  const legacy=probe('affine-overclaim');legacy.snapshot.blocks[0].text='$x$ '+legacy.snapshot.blocks[0].text;
  assert.throws(()=>validateClaimPatch(legacy.snapshot,reviewFor(legacy),simulatedClaimReply(legacy,'patch')),/normalization/);
});

test('late or tampered proposals fail after revision, source, goal, document identity or diagnostic evidence changes',()=>{
  const c=first(),review=reviewFor(c),proposal=validateClaimPatch(c.snapshot,review,simulatedClaimReply(c,'patch'));
  for(const change of [s=>s.revision++,s=>s.documentId='other',s=>s.chapterId='other',s=>s.source[0].text+='x',s=>s.goal+='x',s=>s.blocks[0].text+='x']) {
    const stale=structuredClone(c.snapshot);change(stale);assert.throws(()=>previewClaimPatch(stale,review,proposal),/Stale/);
  }
  const changed=structuredClone(proposal);changed.edits[0].nextText='tampered';assert.throws(()=>previewClaimPatch(c.snapshot,review,changed),/modified/);
  const rehashed=structuredClone(proposal);rehashed.edits[0].after='tampered';const {proposalHash,...body}=rehashed;rehashed.proposalHash=fingerprint(body);
  assert.throws(()=>previewClaimPatch(c.snapshot,review,rehashed),/evidence changed/);
  const different=structuredClone(review);different.checks[0].reason+=' changed';assert.throws(()=>previewClaimPatch(c.snapshot,different,proposal),/evidence changed/);
});

test('missing context blocks every patch in a mixed target batch, while cautious claims remain eligible for a clear diagnosis',()=>{
  const gap=probe('context-missing');assert.throws(()=>buildClaimPatchMessages(gap.snapshot,reviewFor(gap)),/Missing source/);
  const c=first(),s=c.snapshot;s.source.push({number:2,text:gap.snapshot.source[0].text});s.blocks.push({id:'p2',text:gap.snapshot.blocks[0].text,sourcePages:[2]});s.targetIds.push('p2');
  const checks=[simulatedClaimReply(c,'review').checks[0],{...simulatedClaimReply(gap,'review').checks[0],blockId:'p2',evidence:[{page:2,quote:gap.reference.quote}]}];
  const review=validateClaimReview(s,{checks});assert.throws(()=>buildClaimPatchMessages(s,review),/Missing source/);
});

test('runner stops after one clear/context diagnosis; issue requires a second request and never persists a note',async()=>{
  for(const id of ['shrink-observed','affine-valid','context-missing']) {
    const c=probe(id),original=structuredClone(c.snapshot),requests=[];
    const result=await runClaimReview(c.snapshot,{config,fetcher:async(url,options)=>{
      requests.push(JSON.parse(options.body));return response(simulatedClaimReply(c,requests.length===1?'review':'patch'));
    }});
    const count=c.expected==='issue'?2:1;
    assert.equal(requests.length,count);assert.equal(result.usage.calls,count);assert.equal(result.usage.completion_tokens,20*count);
    assert.equal(result.status,c.expected==='issue'?'proposal-ready':c.expected);
    assert.ok(requests.every(r=>r.max_tokens===2048&&r.temperature===0));
    assert.ok(!JSON.stringify(result).includes(config.apiKey));assert.deepEqual(c.snapshot,original);
  }
});

test('invalid diagnosis never triggers repair; invalid patch keeps diagnosis and original, with no further format retry',async()=>{
  const c=first();let calls=0;
  const invalidReview=await runClaimReview(c.snapshot,{config,fetcher:async()=>{calls++;return response('invalid JSON');}});
  assert.equal(calls,1);assert.equal(invalidReview.status,'failed');assert.equal(invalidReview.proposal,null);
  calls=0;const badPatch=await runClaimReview(c.snapshot,{config,fetcher:async()=>response(++calls===1?simulatedClaimReply(c,'review'):{edits:[{blockId:'foreign',before:'bad',after:'bad'}]})});
  assert.equal(calls,2);assert.equal(badPatch.status,'failed');assert.equal(badPatch.review.checks[0].verdict,'issue');assert.equal(badPatch.preview,null);
});

test('truncation retries share the same call and output ceilings; two review attempts cannot make a third patch request',async()=>{
  const c=first();let calls=0;
  const result=await runClaimReview(c.snapshot,{config,fetcher:async()=>++calls===1?response('{','length'):response(simulatedClaimReply(c,'review'))});
  assert.equal(calls,2);assert.equal(result.status,'failed');assert.equal(result.error.code,'EVAL_CALL_BUDGET');assert.equal(result.error.stage,'patch');
  assert.equal(result.review.checks[0].verdict,'issue');assert.equal(result.proposal,null);
  assert.ok(result.trace.reduce((n,t)=>n+t.reservedCompletionTokens,0)<=4096);
});

test('cancellation between review and patch stops before spending a second call; aborted input makes zero calls',async()=>{
  const c=first(),controller=new AbortController();let calls=0;
  const result=await runClaimReview(c.snapshot,{config,signal:controller.signal,fetcher:async()=>{calls++;return response(simulatedClaimReply(c,'review'));},onStage:async r=>{if(r.status==='running')controller.abort();}});
  assert.equal(calls,1);assert.equal(result.status,'failed');assert.equal(result.preview,null);
  const stopped=await runClaimReview(c.snapshot,{config,signal:controller.signal,fetcher:async()=>{calls++;}});
  assert.equal(calls,1);assert.equal(stopped.trace.length,0);
});

test('offline matrix never invokes the supplied network adapter, preserves all outcomes, and renders shared math safely',async()=>{
  let external=0;const run=await runClaims(planClaims(),{fetcher:async()=>{external++;throw new Error('network');}});
  assert.equal(external,0);const report=inspectClaims(run);
  assert.equal(report.totals.cases,8);assert.equal(report.totals.calls,11);assert.equal(report.totals.proposals,3);assert.equal(report.totals.failed,0);
  assert.equal(report.labelAgreement,null);assert.equal(report.qualityConclusion,null);assert.equal(report.totals.promptTokens,null);
  const dom=new JSDOM(claimsHTML(run));assert.equal(dom.window.document.querySelectorAll('article').length,8);
  assert.equal(dom.window.document.querySelectorAll('.provider-trace').length,8);
  assert.ok(dom.window.document.querySelectorAll('.math-node svg').length>10);assert.equal(dom.window.document.querySelectorAll('script').length,0);
  const hostile=structuredClone(run);hostile.model='<script>alert(1)</script>';const {artifactHash,...body}=hostile;hostile.artifactHash=fingerprint(body);
  const safe=new JSDOM(claimsHTML(hostile));assert.equal(safe.window.document.querySelectorAll('script').length,0);assert.ok(safe.window.document.body.textContent.includes('<script>alert(1)</script>'));
  const tampered=structuredClone(run);tampered.candidates[0].result.snapshot.blocks[0].text+='changed';assert.throws(()=>inspectClaims(tampered),/hash/);
  dom.window.close();safe.window.close();
});

test('frozen plan detects prompt, oracle label and budget changes before any model call',async()=>{
  for(const change of [p=>p.prompts[0].messages[0].content+='x',p=>p.cases[0].expected='no-issue-found',p=>p.budget={...p.budget,maxCalls:10}]) {
    const plan=structuredClone(planClaims(['shrink-observed']));change(plan);let called=0;
    await assert.rejects(runClaims(plan,{mode:'live',config,fetcher:async()=>{called++;}}),/plan changed/);assert.equal(called,0);
  }
  assert.throws(()=>planClaims(['not-present']));assert.throws(()=>planClaims(['shrink-observed','shrink-observed']));
  assert.throws(()=>execFileSync(process.execPath,['scripts/evaluate-claims.mjs','--live'],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true,stdio:'pipe'}),e=>e.status===1&&/require --case/.test(e.stderr));
});

const archived=()=>JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18/run.json',import.meta.url),'utf8'));
test('archived live review preserves the frozen plan, all eight outcomes and actual provider budgets without a quality score',()=>{
  const run=archived(),report=inspectClaims(run);
  assert.equal(run.gitDirty,false);assert.equal(run.gitRevision,'324a367cbbfaa9dbc15201c2d013de52d8c9fac5');
  assert.equal(fingerprint(run.plan),fingerprint(planClaims()));
  assert.deepEqual(report.totals,{cases:8,calls:10,promptTokens:8380,completionTokens:2056,proposals:2,failed:2});
  assert.equal(report.labelAgreement,4);assert.equal(report.qualityConclusion,null);assert.equal(report.semanticJudgment,'unverified');
  assert.ok(run.candidates.every(c=>c.result.trace.every(t=>t.response.choices[0].finish_reason==='stop')));
  assert.ok(run.candidates.every(c=>!c.result.events.some(e=>e.repair)));
  assert.equal(run.candidates.filter(c=>c.result.status==='no-issue-found').length,4);
  const dom=new JSDOM(claimsHTML(run));
  assert.ok(dom.window.document.querySelector('[data-case="shrink-observed"] .provider-trace').textContent.includes('属于把局部结论推广成必然'));
  dom.window.close();
});

test('real structured failures stay rejected while a semantically missed condition and context-policy deviation remain visible',()=>{
  const run=archived();
  for(const id of ['shrink-observed','affine-valid']) {
    const r=run.candidates.find(c=>c.id===id).result,raw=JSON.parse(r.trace[0].response.choices[0].message.content);
    assert.equal(raw.checks.length,2);assert.deepEqual(raw.checks.map(c=>c.blockId),['p1','p1']);
    assert.throws(()=>validateClaimReview(r.snapshot,raw),/cover each target/);
    assert.equal(r.proposal,null);assert.equal(r.preview,null);assert.equal(r.usage.calls,1);
  }
  const missed=run.candidates.find(c=>c.id==='affine-overclaim').result;
  assert.equal(missed.status,'no-issue-found');assert.equal(missed.review.checks[0].verdict,'no-issue-found');
  assert.ok(missed.review.checks[0].reason.includes('可理解为在 b≠0 的语境'));
  // Mechanical validation accepts this evidence. The fixed oracle, not this
  // validator, establishes a counterexample to the original statement.
  assert.doesNotThrow(()=>validateClaimReview(missed.snapshot,{checks:missed.review.checks}));
  const gap=run.candidates.find(c=>c.id==='context-missing').result;
  assert.equal(gap.status,'proposal-ready');assert.equal(gap.review.checks[0].missingContext,'');
  assert.ok(gap.proposal.edits[0].after.includes('未给出收敛定理或证明'));
  assert.equal(probe('context-missing').expected,'needs-context');
});

test('provisional findings bind to the real artifact and every quoted diagnosis or patch; no case disappears',()=>{
  const run=archived(),f=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18/findings.json',import.meta.url),'utf8'));
  assert.equal(f.runArtifactHash,run.artifactHash);assert.equal(f.status,'provisional-ai-review');assert.equal(f.semanticJudgment,'unverified');
  assert.deepEqual([...new Set(f.findings.flatMap(f=>f.cases))].sort(),run.candidates.map(c=>c.id).sort());
  for(const finding of f.findings)for(const e of finding.evidence) {
    assert.ok(finding.cases.includes(e.caseId));const trace=run.candidates.find(c=>c.id===e.caseId).result.trace.find(t=>t.stage===e.stage);
    const raw=JSON.parse(trace.response.choices[0].message.content),field=e.path.split('.').reduce((value,key)=>value?.[key],raw);
    assert.equal(typeof field,'string');assert.ok(field.includes(e.quote));
  }
  // Instantiate the model's qualitative sampling example independently.
  const small=[0,0,1,1],large=Array(16).fill(1),mean=a=>a.reduce((s,v)=>s+v)/a.length;
  assert.equal(Math.abs(mean(small)-.5),0);assert.equal(Math.abs(mean(large)-.5),.5);
  close(Math.sqrt(.25/16),Math.sqrt(.25/4)/2);
});
