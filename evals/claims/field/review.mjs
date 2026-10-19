import { fingerprint } from '../../../server/claim-review.mjs';
import { inspectField } from './experiment.mjs';

export function createFieldReview(run) {
  const report=inspectField(run);
  const body={version:'field-human-review-v1',artifactHash:run.artifactHash,mode:run.mode,title:run.plan.material.title,goal:run.plan.request.document.intent,
    provenance:run.plan.material.provenance,source:run.plan.request.document.pages,blocks:run.generation.result?.blocks||[],
    units:report.coverage.map(({id,blockId,start,end,text,status,diagnosis})=>({id,blockId,start,end,text,status,diagnosis}))};
  const packet={...body,packetHash:fingerprint(body)};
  const review={version:packet.version,packetHash:packet.packetHash,reviewer:'',reviewerType:null,participatedInDevelopment:null,seenModelBefore:null,reviewedAt:'',
    records:packet.units.map(u=>({id:u.id,verdict:null,reason:'',sourcePage:null,sourceQuote:'',exposed:false,initial:null}))};
  return {packet,review};
}

// These dependency-free functions are also embedded in the workbook, so
// imported drafts and CLI summaries share the same validation contract.
export function validateFieldReview(packet,review) {
  const fail=message=>{throw new Error(message);};
  const keys=(object,allowed)=>{if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(object,k)))fail('Unexpected review fields');};
  const string=(v,max)=>typeof v==='string'&&v.length<=max;
  keys(review,['version','packetHash','reviewer','reviewerType','participatedInDevelopment','seenModelBefore','reviewedAt','records']);
  if(review.version!==packet.version||review.packetHash!==packet.packetHash)fail('Review belongs to another artifact');
  if(!string(review.reviewer,160)||!string(review.reviewedAt,100)||!['human','ai',null].includes(review.reviewerType)||![null,true,false].includes(review.participatedInDevelopment)||![null,true,false].includes(review.seenModelBefore))fail('Invalid reviewer metadata');
  if(review.reviewedAt&&!Number.isFinite(Date.parse(review.reviewedAt)))fail('Invalid review date');
  if(!Array.isArray(review.records)||review.records.length!==packet.units.length||new Set(review.records.map(r=>r?.id)).size!==packet.units.length)fail('Missing or duplicate review units');
  const fields=['verdict','reason','sourcePage','sourceQuote'];
  const check=entry=>{
    if(![null,'retain','contradiction','missing-condition','needs-source'].includes(entry.verdict)||!string(entry.reason,4000)||!string(entry.sourceQuote,3000)||!(entry.sourcePage===null||Number.isSafeInteger(entry.sourcePage)))fail('Invalid judgment fields');
    if(entry.sourcePage!==null&&!packet.source.some(p=>p.number===entry.sourcePage))fail('Unknown source page');
    if(entry.sourceQuote&&(!entry.sourceQuote.trim()||!packet.source.find(p=>p.number===entry.sourcePage)?.text.includes(entry.sourceQuote)))fail('Source quote is not an exact page span');
  };
  for(const entry of review.records) {
    keys(entry,['id',...fields,'exposed','initial']);
    if(!packet.units.some(u=>u.id===entry.id)||typeof entry.exposed!=='boolean')fail('Unknown review unit');
    check(entry);
    if(entry.exposed){keys(entry.initial,fields);check(entry.initial);}else if(entry.initial!==null)fail('Unexposed judgment has a frozen initial record');
  }
  return review;
}
export function judgmentComplete(record) {
  return !!record?.verdict&&typeof record.reason==='string'&&record.reason.trim().length>=4&&
    (!['contradiction','missing-condition'].includes(record.verdict)||(Number.isSafeInteger(record.sourcePage)&&!!record.sourceQuote?.trim()));
}
export function summarizeFieldReview(run,review) {
  const {packet}=createFieldReview(run);validateFieldReview(packet,review);
  const completeMetadata=review.reviewer.trim()&&review.reviewerType&&typeof review.participatedInDevelopment==='boolean'&&typeof review.seenModelBefore==='boolean'&&review.reviewedAt;
  const rows=packet.units.map(unit=>{
    const record=review.records.find(r=>r.id===unit.id),initial=record.exposed?record.initial:record;
    const initialComplete=judgmentComplete(initial),finalComplete=judgmentComplete(record),model=unit.diagnosis?.verdict||null;
    const problem=v=>['contradiction','missing-condition'].includes(v);
    const relation=!initialComplete?'unreviewed':!model?'model-unavailable':problem(initial.verdict)&&model==='retain'?'possible-miss':initial.verdict==='retain'&&problem(model)?'possible-false-alarm':initial.verdict===model?'agreement':'different-classification';
    return {id:unit.id,text:unit.text,initial:structuredClone(initial),current:structuredClone(record),initialComplete,finalComplete,model,relation,
      selfReportedIndependent:!!(completeMetadata&&run.mode==='live'&&review.reviewerType==='human'&&!review.participatedInDevelopment&&!review.seenModelBefore&&initialComplete)};
  });
  return {version:packet.version,artifactHash:run.artifactHash,packetHash:packet.packetHash,mode:run.mode,status:!packet.units.length?'no-reviewable-output':completeMetadata&&rows.every(r=>r.finalComplete)?'review-recorded':'awaiting-human-review',
    reviewer:review.reviewer,reviewerType:review.reviewerType,rows,counts:Object.fromEntries(['unreviewed','model-unavailable','possible-miss','possible-false-alarm','agreement','different-classification'].map(k=>[k,rows.filter(r=>r.relation===k).length])),qualityConclusion:null,
    independence:'Self-reported only; the offline file contains model output. Exposure records are not a proof of blinding, identity or expertise.'};
}
