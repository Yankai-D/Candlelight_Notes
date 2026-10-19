import { calculationCases, extractionFixture, comparisonFixture } from './cases.mjs';
import { fingerprint } from '../../../server/claim-review.mjs';
import { auditUnits } from '../../../server/claim-audit.mjs';
import { conditionPrompt, buildConditionMessages } from '../../../server/condition-review.mjs';
import { CALCULATION_REVIEW_VERSION, extractionPrompt, comparisonPrompt, calculationBudget, calculationStageBudget, buildExtractionMessages, buildCalculationMessages, validateExtraction, validateCalculationReview, runCalculationReview } from '../../../server/calculation-review.mjs';
import { diagnosticBudget, runDiagnostic, inspectDiagnosticExecution, diagnosticTotals } from '../focused/experiment.mjs';

const arms=['focused','calculation'];
const digest=({artifactHash,...run})=>fingerprint(run);
const fail=message=>{throw new Error(message);};
export function planCalculation(ids=calculationCases.map(c=>c.id)) {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!calculationCases.some(c=>c.id===id)))fail('Unknown or duplicated calculation case');
  const cases=ids.map(id=>structuredClone(calculationCases.find(c=>c.id===id)));
  const policy={focused:conditionPrompt,extract:extractionPrompt,compare:comparisonPrompt};
  const candidates=cases.flatMap((c,i)=>(i%2?[...arms].reverse():arms).map(arm=>({id:`${c.id}/${arm}`,caseId:c.id,arm,firstMessages:arm==='focused'?buildConditionMessages(c.snapshot):buildExtractionMessages(c.snapshot)})));
  return {schema:5,version:CALCULATION_REVIEW_VERSION,ids,cases,policy,policyHash:fingerprint(policy),budgets:{focused:diagnosticBudget,calculation:calculationBudget,stage:calculationStageBudget},candidates,maxCalls:cases.length*3,maxCompletionTokens:cases.length*6144,
    limitations:['比较完整任务机制：基线一次复核，对照组先提取再比较；调用次数与可用总输出预算不同，分别报告实际成本。','提取不见 source 正文，但保留笔记全部上下文，笔记内公式仍可见；不声称模型完全不受正确公式影响。','六例为已见开发材料，两例新控制与协议共同设计；没有独立留出集或人工认证。','解释表达式为不可执行文本；引文、覆盖和阶段绑定可机械验证，解释是否忠实及比较是否正确仍待语义审阅。','任何阶段失败均保留原始轨迹并停止该候选，无格式修复或自动改稿；不会写入用户笔记。']};
}
export async function runCalculationExperiment(plan,{mode='simulation',config,fetcher=fetch,onStage=async()=>{},gitRevision=null,gitDirty=null}={}) {
  if(fingerprint(plan)!==fingerprint(planCalculation(plan.ids)))fail('Frozen calculation plan changed');
  if(!['simulation','live'].includes(mode))fail('Invalid execution mode');
  const selected=mode==='simulation'?{apiKey:'offline-only',baseUrl:'https://api.deepseek.com',model:'offline-fixture'}:config;
  const run={schema:5,mode,model:selected?.model,endpoint:selected?.baseUrl,createdAt:new Date().toISOString(),gitRevision,gitDirty,plan,planHash:fingerprint(plan),candidates:[]};
  for(const p of plan.candidates) {
    const c=plan.cases.find(c=>c.id===p.caseId),candidate={id:p.id,caseId:c.id,arm:p.arm,result:null};run.candidates.push(candidate);
    let calls=0;
    const provider=mode==='simulation'?async()=>{
      const extraction=extractionFixture(c);
      const content=p.arm==='focused'?{checks:comparisonFixture(c,extraction).checks}:calls++===0?extraction:comparisonFixture(c,extraction);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}));
    }:fetcher;
    candidate.result=p.arm==='focused'?await runDiagnostic('focused',c.snapshot,{config:selected,fetcher:provider}):await runCalculationReview(c.snapshot,{config:selected,fetcher:provider,onStage:async result=>{candidate.result=result;await onStage(run,candidate);}});
    await onStage(run,candidate);
  }
  run.artifactHash=digest(run);return run;
}
export function inspectCalculationExecution(r,{snapshot,model}) {
  if(r.arm!=='calculation'||r.snapshotHash!==fingerprint(snapshot)||fingerprint(r.snapshot)!==r.snapshotHash||fingerprint(r.budget)!==fingerprint(calculationBudget))fail('Calculation identity changed');
  if(!['diagnosed','failed'].includes(r.status)||r.stages.length<1||r.stages.length>2||fingerprint(r.trace)!==fingerprint(r.stages.flatMap(s=>s.trace)))fail('Invalid stage coverage');
  let extraction=null,diagnostic=null,failed=false;
  for(const [i,stage] of r.stages.entries()) {
    if(failed||stage.name!==['extract','compare'][i]||!['accepted','failed'].includes(stage.status)||stage.trace.length>1)fail('Invalid calculation execution order');
    const messages=i===0?buildExtractionMessages(snapshot):buildCalculationMessages(snapshot,extraction);
    for(const t of stage.trace) {
      if(fingerprint(t.request.messages)!==fingerprint(messages)||t.request.model!==model||t.request.temperature!==calculationStageBudget.temperature)fail('Calculation provider context changed');
      if(!Number.isInteger(t.request.max_tokens)||t.request.max_tokens<1||t.request.max_tokens>2048||JSON.stringify(messages).length>calculationStageBudget.maxPromptCharacters)fail('Exceeded stage budget');
    }
    if(stage.status==='accepted') {
      const response=stage.trace[0]?.response?.choices?.[0];if(response?.finish_reason!=='stop')fail('Accepted stage has no complete response');
      if(i===0)extraction=validateExtraction(snapshot,response.message.content);
      else diagnostic=validateCalculationReview(snapshot,extraction,response.message.content);
    }else failed=true;
  }
  if(fingerprint(extraction)!==fingerprint(r.extraction)||fingerprint(diagnostic)!==fingerprint(r.diagnostic))fail('Stage result differs from raw response');
  if(r.status==='diagnosed'&&(!diagnostic||failed)||r.status==='failed'&&(!failed||diagnostic||!r.error?.code||r.error.stage!==r.stages.at(-1).name))fail('Invalid terminal calculation state');
}
export function inspectCalculation(run) {
  if(run.schema!==5||run.planHash!==fingerprint(run.plan)||run.artifactHash!==digest(run)||fingerprint(run.plan)!==fingerprint(planCalculation(run.plan.ids)))fail('Calculation artifact or frozen plan changed');
  if(!['simulation','live'].includes(run.mode)||run.candidates.length!==run.plan.candidates.length||new Set(run.candidates.map(c=>c.id)).size!==run.candidates.length)fail('Invalid candidate coverage');
  const rows=run.candidates.map((c,index)=>{
    const p=run.plan.candidates[index],testCase=run.plan.cases.find(t=>t.id===c.caseId),r=c.result;
    if(c.id!==p.id||c.arm!==p.arm||c.caseId!==p.caseId)fail('Candidate identity changed');
    if(c.arm==='focused')inspectDiagnosticExecution(r,{arm:c.arm,snapshot:testCase.snapshot,messages:p.firstMessages,model:run.model});
    else inspectCalculationExecution(r,{snapshot:testCase.snapshot,model:run.model});
    const units=auditUnits(testCase.snapshot).filter(u=>u.target).map(u=>{
      const expected=testCase.reference.issues.find(i=>i.unitId===u.id)?.verdict||'retain',actual=r.diagnostic?.checks.find(k=>k.unitId===u.id)?.verdict||null;
      return {unitId:u.id,expected,actual,referenceAgreement:actual===null?null:actual===expected,interpretation:r.extraction?.units.find(k=>k.unitId===u.id)||null,comparisons:r.diagnostic?.comparisons?.filter(k=>k.unitId===u.id)||[]};
    });
    return {id:c.id,caseId:c.caseId,arm:c.arm,status:r.status,failedStage:r.error?.stage||null,units,allUnitsAgree:r.status==='diagnosed'?units.every(u=>u.referenceAgreement):null};
  });
  return {mode:run.mode,rows,totals:diagnosticTotals(run.candidates),byArm:Object.fromEntries(arms.map(arm=>[arm,diagnosticTotals(run.candidates.filter(c=>c.arm===arm))])),qualityConclusion:null,semanticJudgment:'unverified',limitations:run.plan.limitations};
}
export function calculationMarkdown(run) {
  const r=inspectCalculation(run);
  const records=r.rows.filter(row=>row.arm==='calculation').map(row=>{
    const result=run.candidates.find(c=>c.id===row.id).result;
    const record={error:result.error||null,units:row.units,stages:result.stages.map(s=>({name:s.name,status:s.status,raw:s.trace[0]?.response?.choices?.[0]?.message?.content||null}))};
    return `### ${row.caseId}\n\n`+'```json\n'+JSON.stringify(record,null,2).replaceAll('`','\\u0060')+'\n```\n';
  }).join('\n');
  return `# 先解释文字，再比较来源\n\n${run.mode==='live'?'真实模型结果；语义判断未独立认证。':'离线模拟，0 次真实模型调用，没有质量成绩。'}\n\n| 案例 | 组别 | 执行 | 与开发参考一致 | 不一致单元 |\n| --- | --- | --- | --- | --- |\n${r.rows.map(row=>`| ${row.caseId} | ${row.arm} | ${row.status}${row.failedStage?' / '+row.failedStage:''} | ${row.allUnitsAgree??'无有效诊断'} | ${row.units.filter(u=>u.referenceAgreement!==true).map(u=>`${u.unitId}: ${u.expected} → ${u.actual||'未完成'}`).join('; ')||'—'} |`).join('\n')}\n\n| 组别 | 实际请求 | 输入 tokens | 输出 tokens | 失败候选 |\n| --- | --- | --- | --- | --- |\n${Object.entries(r.byArm).map(([arm,t])=>`| ${arm} | ${t.calls} | ${t.promptTokens??'未报告'} | ${t.completionTokens??'未报告'} | ${t.failures} |`).join('\n')}\n\n${r.limitations.map(l=>`- ${l}`).join('\n')}\n\n## 提取与比较记录\n\n${records}`;
}
