import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint } from '../server/claim-review.mjs';
import { checkArithmetic } from '../server/claim-arithmetic.mjs';
import { auditUnits, auditPrompt, validateAudit, buildAuditMessages, buildAuditPatchMessages, validateAuditPatch, previewAuditPatch, runClaimAudit } from '../server/claim-audit.mjs';
import { migrationCases, fixtureReview, fixturePatch, affineWitness, shrinkWitness, number, op } from '../evals/claims/v2/fixtures.mjs';

const probe=id=>structuredClone(migrationCases.find(c=>c.id===id));
const first=()=>probe('shrink-observed');
const config={model:'test-only',baseUrl:'https://api.deepseek.com',apiKey:'AUDIT_SECRET_SENTINEL'};
const response=(raw,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:typeof raw==='string'?raw:JSON.stringify(raw)}}],usage:{prompt_tokens:10,completion_tokens:20}}));
const select=audit=>({kind:'correction',claimIds:audit.claims.filter(c=>['correct','qualify'].includes(c.route)).map(c=>c.id)});
const verified=c=>validateAudit(c.snapshot,fixtureReview(c));

test('deterministic text units preserve exact UTF-16 spans, protected math/code, whitespace and repeated sentences',()=>{
  const s=probe('affine-overclaim').snapshot;
  s.blocks[0].text=String.raw`  开头😀。\(x=1.5; y=2\) 仍是公式；`+'代码 `a; b。` 保留。重复。重复。  ';
  const units=auditUnits(s);assert.equal(units.length,5);
  for(const u of units)assert.equal(s.blocks[0].text.slice(u.start,u.end),u.text);
  assert.ok(units[1].text.includes('x=1.5; y=2'));assert.ok(units[2].text.includes('a; b。'));
  assert.notEqual(units[3].id,units[4].id);assert.equal(units[3].text,units[4].text);
  let end=0;for(const u of units){assert.equal(s.blocks[0].text.slice(end,u.start).trim(),'');end=u.end;}assert.equal(s.blocks[0].text.slice(end).trim(),'');
  s.blocks[0].text='x。'.repeat(13);assert.throws(()=>auditUnits(s),e=>e.code==='AUDIT_UNIT_LIMIT');
  s.blocks[0].text=String.raw`公式 \(x。`;assert.throws(()=>auditUnits(s),e=>e.code==='AUDIT_UNIT_FORMAT');
});

test('exact arithmetic checks rational witnesses without executing text or certifying source mapping or domain assumptions',()=>{
  assert.deepEqual(checkArithmetic(affineWitness),{left:'8',right:'8',relation:'equal',status:'arithmetic-checked',sourceMapping:'unverified',domainAssumptions:'unverified'});
  assert.equal(checkArithmetic(shrinkWitness).left,'0');
  const thirds={variables:{},left:op('add',number('1/3'),number('2/3')),right:number(1),relation:'equal'};
  assert.equal(checkArithmetic(thirds).left,'1');
  const wrong=structuredClone(affineWitness);wrong.relation='different';assert.throws(()=>checkArithmetic(wrong),e=>e.code==='CLAIM_ARITHMETIC_MISMATCH');
  for(const expression of [{value:'Infinity'},{value:'1/0'},{value:'1000000'},{op:'exec',args:[{value:'process.env'}]},op('divide',number(1),number(0)),{variable:'unknown'}]) {
    assert.throws(()=>checkArithmetic({...thirds,left:expression}),e=>e.code==='CLAIM_ARITHMETIC_INVALID');
  }
  let nested=number(1);for(let i=0;i<9;i++)nested=op('negate',nested);
  assert.throws(()=>checkArithmetic({...thirds,left:nested}),e=>e.code==='CLAIM_ARITHMETIC_INVALID');
});

test('multi-claim paragraphs retain coverage without rewriting original sentences or accepting old malformed responses',()=>{
  for(const c of migrationCases) {
    const audit=verified(c);assert.equal(audit.version,'claim-audit-v2');
    assert.equal(audit.semanticStatus,'model-proposal-unverified');
    assert.equal(new Set(audit.claims.flatMap(c=>c.unitIds)).size,audit.units.filter(u=>u.target).length);
    assert.deepEqual(JSON.parse(buildAuditMessages(c.snapshot)[1].content).snapshot,c.snapshot);
    assert.ok(!JSON.stringify(buildAuditMessages(c.snapshot)).includes('v1 known-failure development regression'));
  }
  assert.ok(verified(first()).claims.length>1);
  const archive=JSON.parse(readFileSync(new URL('../evals/claims/runs/2026-10-18/run.json',import.meta.url),'utf8'));
  const old=archive.candidates.find(c=>c.id==='shrink-observed').result;
  assert.throws(()=>validateAudit(old.snapshot,old.trace[0].response.choices[0].message.content));
});

test('audit rejects missing, repeated, reordered, noncontiguous and foreign units instead of silently dropping a conclusion',()=>{
  const c=first(),raw=()=>fixtureReview(c);
  for(const change of [r=>r.blocks[0].claims.pop(),r=>r.blocks.push(structuredClone(r.blocks[0])),
    r=>r.blocks[0].claims[0].unitIds.push(r.blocks[0].claims[0].unitIds[0]),r=>r.blocks[0].claims[0].unitIds.reverse(),
    r=>r.blocks[0].claims[0].unitIds[0]='context-1:s1',r=>r.blocks[0].claims[0].unitIds.splice(1,1)]) {
    const r=raw();change(r);assert.throws(()=>validateAudit(c.snapshot,r));
  }
});

test('premise provenance blocks unsupported assumptions, requires explicit qualification and accepts real surrounding context',()=>{
  const c=probe('affine-overclaim');const raw={blocks:[{blockId:'p1',claims:[{unitIds:auditUnits(c.snapshot).filter(u=>u.target).map(u=>u.id),assertion:'两个映射总不同',
    premises:[{text:'b 不为零',noteEvidence:[],sourceEvidence:[]}],support:{kind:'derived',evidence:[{page:1,quote:c.reference.quote}],reason:'复现上一轮擅自补充前提的行为',steps:['暂时假设 b 不为零，因此差不为零。']}}]}]};
  assert.equal(validateAudit(c.snapshot,raw).claims[0].route,'needs-source');
  const p=raw.blocks[0].claims[0].premises[0];p.sourceEvidence=[{page:1,quote:c.reference.quote}];
  // Citation existence is all the program checks: it cannot certify that this
  // quote actually states the condition. Never present this route as truth.
  assert.equal(validateAudit(c.snapshot,raw).claims[0].route,'qualify');
  c.snapshot.blocks.unshift({id:'context',text:'这里固定 b 不为零。',sourcePages:[1]});
  p.noteEvidence=[{unitId:'context:s1',quote:'b 不为零'}];
  assert.equal(validateAudit(c.snapshot,raw).claims[0].route,'preserve');
  p.noteEvidence[0].quote='c 不为零';assert.throws(()=>validateAudit(c.snapshot,raw),e=>e.code==='AUDIT_PREMISE');
});

test('source gaps and counterexamples are distinct structures; unknown evidence and false arithmetic are rejected',()=>{
  const gap=probe('context-missing'),raw=fixtureReview(gap);
  const claim=raw.blocks[0].claims.find(c=>c.support.kind==='insufficient');
  assert.equal(verified(gap).claims.find(c=>c.support.kind==='insufficient').route,'needs-source');
  claim.support.refutation={kind:'source',statement:{page:1,quote:gap.reference.quote}};
  assert.throws(()=>validateAudit(gap.snapshot,raw));
  const c=probe('affine-overclaim'),r=fixtureReview(c),bad=r.blocks[0].claims.find(c=>c.support.kind==='contradicted');
  bad.support.refutation.arithmetic.relation='different';assert.throws(()=>validateAudit(c.snapshot,r),e=>e.code==='CLAIM_ARITHMETIC_MISMATCH');
  const fake=fixtureReview(c);fake.blocks[0].claims[0].support.evidence[0].page=2;
  assert.throws(()=>validateAudit(c.snapshot,fake),e=>e.code==='AUDIT_SOURCE');
});

test('multiple disjoint claim replacements use original offsets and preserve intervening text, formulas and immutable input',()=>{
  const c=probe('affine-overclaim'),snapshot=c.snapshot,raw=fixtureReview(c);
  const first=raw.blocks[0].claims[0];first.support=structuredClone(raw.blocks[0].claims.at(-1).support);
  const audit=validateAudit(snapshot,raw),selection=select(audit),before=structuredClone(snapshot);
  const patch={edits:audit.claims.map((c,i)=>({claimId:c.id,after:i===0?'保留公式对照。':String.raw`两者仅在 \((c-1)b\ne0\) 时不同。`}))};
  const proposal=validateAuditPatch(snapshot,audit,selection,patch),preview=previewAuditPatch(snapshot,audit,proposal);
  assert.equal(preview.blocks[0].text,patch.edits.map(e=>e.after).join(''));
  assert.deepEqual(snapshot,before);assert.deepEqual(preview.source,snapshot.source);assert.equal(preview.revision,snapshot.revision);
  const single=verified(c),one=select(single),p=validateAuditPatch(snapshot,single,one,fixturePatch(c,fixtureReview(c),one));
  assert.ok(p.preview.blocks[0].text.startsWith(snapshot.blocks[0].text.slice(0,single.claims.at(-1).start)));
});

test('patch contract separates correction from explicit withdrawal and rejects ambiguity, tampering, stale goals and invalid math',()=>{
  const gap=probe('context-missing'),audit=verified(gap),ids=audit.claims.filter(c=>c.route==='needs-source').map(c=>c.id);
  assert.throws(()=>buildAuditPatchMessages(gap.snapshot,audit,{kind:'correction',claimIds:ids}),e=>e.code==='AUDIT_ACTION');
  const selected={kind:'withdrawal',claimIds:ids},proposal=validateAuditPatch(gap.snapshot,audit,selected,fixturePatch(gap,fixtureReview(gap),selected));
  assert.equal(proposal.selection.kind,'withdrawal');
  const stale=structuredClone(gap.snapshot);stale.goal+='x';assert.throws(()=>previewAuditPatch(stale,audit,proposal),e=>e.code==='AUDIT_STALE');
  const altered=structuredClone(audit);altered.claims[0].route='correct';assert.throws(()=>buildAuditPatchMessages(gap.snapshot,altered,selected),e=>e.code==='AUDIT_CHANGED');
  const bad=structuredClone(proposal);bad.preview.blocks[0].text='changed';assert.throws(()=>previewAuditPatch(gap.snapshot,audit,bad),e=>e.code==='AUDIT_CHANGED');
  assert.throws(()=>validateAuditPatch(gap.snapshot,audit,selected,{edits:[{claimId:ids[0],after:String.raw`坏公式 \(\frac{x}{y\)`}]}));
  assert.throws(()=>validateAuditPatch(gap.snapshot,audit,selected,{edits:[{claimId:'foreign',after:'changed'}]}),e=>e.code==='AUDIT_SCOPE');
});

async function runFixture(c,options={}) {
  const requests=[];
  const result=await runClaimAudit(c.snapshot,{config,...options,fetcher:async(url,request)=>{
    const body=JSON.parse(request.body);requests.push(body);
    const raw=body.messages[0].content===auditPrompt?fixtureReview(c):fixturePatch(c,fixtureReview(c),JSON.parse(body.messages[1].content).selection);
    return response(raw);
  }});return {result,requests};
}
test('default runner preserves correct claims, offers bounded corrections and stops on missing source with no second request',async()=>{
  for(const id of ['shrink-observed','affine-valid','context-missing']) {
    const c=probe(id),original=fingerprint(c.snapshot),{result,requests}=await runFixture(c);
    assert.equal(requests.length,id==='shrink-observed'?2:1);
    assert.equal(result.status,id==='shrink-observed'?'correction-proposed':id==='affine-valid'?'no-change-proposed':'needs-source');
    assert.equal(fingerprint(c.snapshot),original);assert.ok(requests.every(r=>r.max_tokens===2048&&r.temperature===0));
    assert.ok(!JSON.stringify(result).includes(config.apiKey));
  }
  const {result,requests}=await runFixture(probe('context-missing'),{withdrawUnsupported:true});
  assert.equal(result.status,'withdrawal-proposed');assert.equal(requests.length,2);assert.equal(result.selection.kind,'withdrawal');
});

test('cancellation, bad review, late patch failure and truncation keep original notes and never bypass two-call ceiling',async()=>{
  const c=probe('affine-overclaim');let calls=0;
  const invalid=await runClaimAudit(c.snapshot,{config,fetcher:async()=>{calls++;return response('{}');}});
  assert.equal(calls,1);assert.equal(invalid.status,'failed');assert.equal(invalid.preview,null);
  calls=0;const truncated=await runClaimAudit(c.snapshot,{config,fetcher:async()=>response(++calls===1?'{':fixtureReview(c),calls===1?'length':'stop')});
  assert.equal(calls,2);assert.equal(truncated.error.code,'EVAL_CALL_BUDGET');assert.ok(truncated.audit);assert.equal(truncated.preview,null);
  const controller=new AbortController();calls=0;
  const cancelled=await runClaimAudit(c.snapshot,{config,signal:controller.signal,fetcher:async()=>{calls++;return response(fixtureReview(c));},onStage:async r=>{if(r.status==='running')controller.abort();}});
  assert.equal(calls,1);assert.equal(cancelled.preview,null);
  calls=0;const late=await runClaimAudit(c.snapshot,{config,fetcher:async()=>response(++calls===1?fixtureReview(c):{edits:[{claimId:'foreign',after:'bad'}]})});
  assert.equal(calls,2);assert.equal(late.error.stage,'patch');assert.ok(late.audit);assert.equal(late.preview,null);
});
