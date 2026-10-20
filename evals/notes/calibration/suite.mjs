import { buildMessages, validateResult, runModel } from '../../../server/harness.mjs';
import { applyResult } from '../../../shared/document.mjs';
import { hash } from '../experiment.mjs';
import { rubric } from '../review.mjs';
import { calibrationCases, calibrationVersion, failureTypes, provenance, rawText, requestFor } from './cases.mjs';

export function createCalibrationPack(cases=calibrationCases) {
  const ids=new Set(),covered=new Set();
  const frozen=cases.map(item=>({ ...structuredClone(item),request:requestFor(item),...(item.anchor?{anchorRequest:requestFor(item,item.anchor.profileId)}:{}) }));
  const corpusHash=hash({version:calibrationVersion,provenance,rubric,failureTypes,cases:frozen});
  const answers={},records=[];
  const tasks=frozen.map(item=>{
    if(ids.has(item.id)||item.candidates.length<2||new Set(item.candidates.map(c=>c.id)).size!==item.candidates.length)throw new Error('Duplicate or empty calibration case');ids.add(item.id);
    if(!item.candidates.some(c=>c.expected.acceptable===true)||!item.candidates.some(c=>c.expected.acceptable===false))throw new Error('Calibration requires positive and negative controls');
    const failure=failureTypes.find(t=>t.id===item.failure);if(!failure)throw new Error('Unknown failure taxonomy');covered.add(failure.dimension);
    // Expected judgments are kept outside the request passed to the harness.
    buildMessages(item.request);
    const sorted=[...item.candidates].sort((a,b)=>hash([item.id,a.id]).localeCompare(hash([item.id,b.id])));
    const candidateIds=sorted.map((candidate,index)=>{
      const id=`${item.id}/${String.fromCharCode(65+index)}`,text=rawText(candidate.raw),e=candidate.expected;
      if(!e.quote||!text.includes(e.quote)||!e.sourceQuote||!item.source.includes(e.sourceQuote))throw new Error(`Unverifiable calibration evidence: ${id}`);
      if(typeof e.acceptable!=='boolean'||typeof e.critical!=='boolean'||typeof e.reason!=='string'||e.reason.trim().length<8||!Array.isArray(e.score)||e.score.length!==2||e.score.some(n=>!Number.isInteger(n)||n<0||n>4)||e.score[0]>e.score[1]||e.acceptable!==(e.score[0]>=3)||e.critical&&e.acceptable)throw new Error(`Invalid reference judgment: ${id}`);
      if(!e.acceptable&&!e.repair)throw new Error('A counterexample needs an actionable repair');
      const result=validateResult(item.request,structuredClone(candidate.raw));
      records.push({id,caseId:item.id,label:String.fromCharCode(65+index),dimension:failure.dimension,text,blocks:result.rendering.blocks,title:result.title||'',action:item.request.action,mechanicalStatus:'accepted'});
      answers[id]={...e,failureCode:e.acceptable?'':item.failure};
      return id;
    });
    const anchor=item.anchor?{profile:item.anchorRequest.knowledge,text:rawText(item.anchor.raw),blocks:validateResult(item.anchorRequest,item.anchor.raw).rendering.blocks}:null;
    return {id:item.id,title:item.title,scope:item.scope,goal:item.goal,source:item.source,context:item.context||'',instruction:item.request.instruction,
      profile:item.request.knowledge,organization:item.request.learning.writingTemplate.organization,template:item.request.learning.writingTemplate.name,dimension:failure.dimension,candidateIds,anchor};
  });
  if(cases===calibrationCases&&rubric.some(d=>!covered.has(d.id)))throw new Error('Calibration does not cover every rubric dimension');
  const packet={version:calibrationVersion,corpusHash,mode:'authored-calibration',provenance,rubric,failureTypes,tasks,records};
  const review={version:calibrationVersion,corpusHash,reviewer:'',reviewedAt:'',revealed:[],records:records.map(r=>({id:r.id,verdict:null,score:null,critical:null,failureCode:null,quote:'',reason:''}))};
  return {packet,answers,review,frozen:{version:calibrationVersion,corpusHash,provenance,rubric,failureTypes,cases:frozen}};
}

export function verifyFrozen(frozen) {
  const {corpusHash,...content}=frozen;
  if(frozen.version!==calibrationVersion||hash(content)!==corpusHash)throw new Error('Calibration corpus hash mismatch');
  // Rebuild from the frozen task, then verify that current prompt/template code
  // has not silently changed the reference exercise.
  const pack=createCalibrationPack(frozen.cases);
  if(pack.packet.corpusHash!==corpusHash)throw new Error('Calibration contract changed; generate a new pack');
  return pack;
}

export function assessCalibration(pack,review) {
  const {packet,answers}=pack;
  if(review?.version!==packet.version||review.corpusHash!==packet.corpusHash)throw new Error('Review belongs to a different calibration pack');
  if(!Array.isArray(review.records)||!Array.isArray(review.revealed))throw new Error('Invalid calibration review');
  const known=new Map(packet.records.map(r=>[r.id,r])),seen=new Set(),missing=[],aligned=[];
  if(typeof review.reviewer!=='string'||!review.reviewer.trim()||review.reviewer.length>160||typeof review.reviewedAt!=='string'||!Number.isFinite(Date.parse(review.reviewedAt)))missing.push('reviewer / reviewedAt');
  if(new Set(review.revealed).size!==review.revealed.length||review.revealed.some(id=>!known.has(id)))throw new Error('Invalid revealed record IDs');
  for(const answer of review.records) {
    const item=known.get(answer.id);if(!item||seen.has(answer.id))throw new Error('Unknown or duplicate calibration record');seen.add(answer.id);
    const e=answers[item.id];
    const validEvidence=typeof answer.quote==='string'&&answer.quote.trim().length>=6&&item.text.includes(answer.quote.trim())&&typeof answer.reason==='string'&&answer.reason.trim().length>=8&&answer.reason.length<=4000;
    const validRating=['acceptable','revise'].includes(answer.verdict)&&Number.isInteger(answer.score)&&answer.score>=0&&answer.score<=4&&typeof answer.critical==='boolean'&&typeof answer.failureCode==='string'&&(!answer.failureCode||packet.failureTypes.some(t=>t.id===answer.failureCode));
    if(!validEvidence||!validRating){missing.push(item.id);continue;}
    const checks={verdict:answer.verdict===(e.acceptable?'acceptable':'revise'),score:answer.score>=e.score[0]&&answer.score<=e.score[1],critical:answer.critical===e.critical,failure:answer.failureCode===e.failureCode};
    aligned.push({id:item.id,dimension:item.dimension,checks,referenceRange:e.score,referenceQuote:e.quote,referenceReason:e.reason,reviewerQuote:answer.quote,reviewerReason:answer.reason,referenceRevealed:review.revealed.includes(item.id)});
  }
  for(const id of known.keys())if(!seen.has(id))missing.push(id);
  return {version:packet.version,corpusHash:packet.corpusHash,mode:packet.mode,status:missing.length?'awaiting-calibration-review':'calibration-reviewed',
    reviewer:review.reviewer,recordCount:known.size,missing,comparisons:aligned,disagreements:aligned.filter(a=>Object.values(a.checks).some(value=>!value)),
    referenceStatus:provenance.reviewStatus,qualityConclusion:null,
    notice:'仅比较审阅判断与开发参考判断；分歧需要讨论，不自动判审阅者错误。不是模型成绩、专家共识或泛化结论。'};
}

const response=(content,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content}}]}),{status:200});
export const regressionDefinitions=[
  {id:'invalid-json',label:'非法 JSON 拒绝提交',expected:'rejected'},
  {id:'foreign-page',label:'本章以外页码拒绝提交',expected:'rejected'},
  {id:'invented-quote',label:'不存在的引文移除精确定位',expected:'quote-cleared'},
  {id:'broken-math',label:'未闭合公式拒绝提交',expected:'rejected'},
  {id:'foreign-edit',label:'其他章节段落不能被局部改写',expected:'rejected'},
  {id:'stale-revision',label:'迟到响应不能覆盖用户编辑',expected:'rejected'},
  {id:'missing-anchor',label:'失效纸条锚点在调用前拒绝',expected:'rejected'},
  {id:'paper-insertion',label:'合法纸条保留原文及后续段落',expected:'inserted'},
  {id:'repair-success',label:'格式修复一次后接受完整正文',expected:'accepted',calls:2},
  {id:'repair-exhausted',label:'连续格式失败换策略后有界结束',expected:'rejected',calls:5},
  {id:'truncation-exhausted',label:'连续截断不进入格式修复循环',expected:'rejected',calls:2},
];

export async function runCalibrationRegressions() {
  const rows=[];
  for(const definition of regressionDefinitions) {
    const item=calibrationCases[0],request=requestFor(item),valid=structuredClone(item.candidates[0].raw);
    let outcome='unexpected',calls=0,errorCode='',detail='',unchanged=true;
    const original=hash(request),events=[];
    try {
      if(definition.id==='invalid-json')validateResult(request,'{"blocks":');
      if(definition.id==='foreign-page'){valid.blocks[0].sourcePages=[999];validateResult(request,valid);}
      if(definition.id==='invented-quote'){
        valid.blocks[0].sourceQuote='THIS_QUOTE_IS_NOT_IN_THE_SOURCE';const result=validateResult(request,valid);
        if(result.blocks[0].sourceQuote===''&&result.blocks[0].sourcePages[0]===1)outcome='quote-cleared';
      }
      if(definition.id==='broken-math'){valid.blocks[0].text=String.raw`未闭合公式 \(x+1`;validateResult(request,valid);}
      if(definition.id==='foreign-edit'){
        const local=requestFor(calibrationCases.find(c=>c.action==='explain'));local.action='style';
        local.document.chapters.push({id:'other',title:'其他章',sourcePages:[1],content:{type:'doc',content:[{type:'paragraph',attrs:{id:'other-block'},content:[{type:'text',text:'不要修改这一段'}]}]}});
        validateResult(local,{edits:[{id:'other-block',text:'越界修改'}],summary:'不允许'});
      }
      if(definition.id==='stale-revision'){
        const document={...request.document,revision:1},snapshot=hash(document);
        try{applyResult(document,request,validateResult(request,valid));}finally{unchanged=hash(document)===snapshot;}
      }
      if(definition.id==='missing-anchor'){const local=requestFor(calibrationCases.find(c=>c.action==='explain'));local.anchorId='missing';buildMessages(local);}
      if(definition.id==='paper-insertion'){
        const paper=calibrationCases.find(c=>c.action==='explain'),local=requestFor(paper);
        local.document.chapters[0].content.content.push({type:'paragraph',attrs:{id:'following'},content:[{type:'text',text:'后续正文需要原样保留。'}]});
        const document={...local.document,revision:0},snapshot=hash(document),before=document.chapters[0].content.content;
        const changed=applyResult(document,local,validateResult(local,paper.candidates[0].raw)),after=changed.chapters[0].content.content;
        unchanged=hash(document)===snapshot&&hash(after[0])===hash(before[0])&&hash(after[2])===hash(before[1]);
        if(after.length===3&&after[1].type==='explanation'&&changed.revision===1)outcome='inserted';
      }
      if(definition.id.startsWith('repair-')||definition.id==='truncation-exhausted') {
        const fetcher=async()=>{calls++;if(calls>definition.calls)throw new Error('UNBOUNDED_CALIBRATION_CALLS');return response(definition.id==='repair-success'&&calls===2?JSON.stringify(valid):'{',definition.id==='truncation-exhausted'?'length':'stop');};
        const raw=await runModel({baseUrl:'https://api.deepseek.com',model:'calibration-offline',apiKey:'calibration-dummy'},buildMessages(request),undefined,fetcher,{action:'generate',onCompletion:e=>events.push(e)});
        validateResult(request,raw);outcome='accepted';
      }
    }catch(error){outcome='rejected';errorCode=error.code||error.name;detail=error.message;}
    const reasonMatches={
      'invalid-json':()=>errorCode==='INVALID_EDIT_FORMAT',
      'foreign-page':()=>detail.includes('本章以外'),
      'broken-math':()=>errorCode==='INVALID_EDIT_FORMAT',
      'foreign-edit':()=>detail.includes('超出范围'),
      'stale-revision':()=>detail.includes('笔记已发生变化'),
      'missing-anchor':()=>detail.includes('插入位置已失效'),
      'repair-success':()=>events.filter(e=>e.repair).length===1,
      'repair-exhausted':()=>errorCode==='WORKFLOW_REVIEW_FAILED'&&events.filter(e=>e.repair).length===2,
      'truncation-exhausted':()=>detail.includes('截断')&&events.filter(e=>e.repair).length===0,
    };
    const pass=outcome===definition.expected&&(definition.calls===undefined?calls===0:calls===definition.calls)&&unchanged&&hash(request)===original&&(!reasonMatches[definition.id]||reasonMatches[definition.id]());
    rows.push({...definition,outcome,calls,pass,errorCode,detail,inputUnchanged:unchanged&&hash(request)===original});
  }
  const pack=createCalibrationPack();
  return {version:calibrationVersion,corpusHash:pack.packet.corpusHash,mode:'offline-regression',passed:rows.every(r=>r.pass),actualModelCalls:0,checks:rows,
    semanticBoundary:{mechanicallyAccepted:pack.packet.records.length,authoredNeedsRevision:Object.values(pack.answers).filter(a=>!a.acceptable).length,
      note:'这些内容反例刻意通过格式校验。它们用于人工校准，当前程序没有自动识别其教学缺陷。'},qualityConclusion:null};
}
