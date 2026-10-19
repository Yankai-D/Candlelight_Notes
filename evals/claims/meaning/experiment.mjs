import { meaningCases, meaningFixture } from './cases.mjs';
import { meaningSuffix, buildMeaningMessages } from './policy.mjs';
import { conditionPrompt, buildConditionMessages } from '../../../server/condition-review.mjs';
import { fingerprint } from '../../../server/claim-review.mjs';
import { auditUnits } from '../../../server/claim-audit.mjs';
import { diagnosticBudget, runDiagnostic, inspectDiagnosticExecution, diagnosticTotals } from '../focused/experiment.mjs';

const arms=['focused','meaning'];
const builders={focused:buildConditionMessages,meaning:buildMeaningMessages};
const digest=({artifactHash,...run})=>fingerprint(run);
export function planMeaning(ids=meaningCases.map(c=>c.id)) {
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!meaningCases.some(c=>c.id===id)))throw new Error('Unknown or duplicated meaning case');
  const cases=ids.map(id=>structuredClone(meaningCases.find(c=>c.id===id)));
  const policy={focused:conditionPrompt,meaning:conditionPrompt+meaningSuffix};
  const candidates=cases.flatMap((c,i)=>(i%2?[...arms].reverse():arms).map(arm=>({id:`${c.id}/${arm}`,caseId:c.id,arm,messages:builders[arm](c.snapshot)})));
  return {schema:4,ids,cases,policy,policyHash:fingerprint(policy),budget:diagnosticBudget,candidates,maxCalls:candidates.length,maxCompletionTokens:candidates.length*diagnosticBudget.maxCompletionTokens,
    limitations:['只增加一个解释与计算含义核对后缀；两组上下文、输出契约、模型和预算相同。','每例每组一次调用，不做格式重试或自动修订；格式失败与语义漏检分开报告。','一例是真实已见漏检，其余为 AI 编写的配对控制与开发迁移探针；没有独立标签或留出集。','逐单元对照参考，错误定位不能靠段落总体标签抵消；标签一致仍不等于理由正确。','语义与教学质量尚待独立审阅，不据本轮自动修改用户笔记或启用生产复核。']};
}
export async function runMeaning(plan,{mode='simulation',config,fetcher=fetch,onStage=async()=>{},gitRevision=null,gitDirty=null}={}) {
  if(fingerprint(plan)!==fingerprint(planMeaning(plan.ids)))throw new Error('Frozen meaning plan changed');
  if(!['simulation','live'].includes(mode))throw new Error('Invalid execution mode');
  const selected=mode==='simulation'?{apiKey:'offline-only',baseUrl:'https://api.deepseek.com',model:'offline-fixture'}:config;
  const run={schema:4,mode,model:selected?.model,endpoint:selected?.baseUrl,createdAt:new Date().toISOString(),gitRevision,gitDirty,plan,planHash:fingerprint(plan),candidates:[]};
  for(const planned of plan.candidates) {
    const c=plan.cases.find(c=>c.id===planned.caseId);
    const provider=mode==='simulation'?async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(meaningFixture(c))}}]})):fetcher;
    const candidate={id:planned.id,caseId:c.id,arm:planned.arm,result:await runDiagnostic(planned.arm,c.snapshot,{config:selected,fetcher:provider})};
    run.candidates.push(candidate);await onStage(run,candidate);
  }
  run.artifactHash=digest(run);return run;
}
export function inspectMeaning(run) {
  if(run.schema!==4||run.planHash!==fingerprint(run.plan)||run.artifactHash!==digest(run))throw new Error('Meaning artifact hash mismatch');
  if(!['simulation','live'].includes(run.mode)||fingerprint(run.plan)!==fingerprint(planMeaning(run.plan.ids)))throw new Error('Frozen plan changed');
  if(run.candidates.length!==run.plan.candidates.length||new Set(run.candidates.map(c=>c.id)).size!==run.candidates.length)throw new Error('Candidate coverage mismatch');
  const rows=run.candidates.map((c,index)=>{
    const p=run.plan.candidates[index],testCase=run.plan.cases.find(t=>t.id===c.caseId),r=c.result;
    if(c.id!==p.id||c.arm!==p.arm||c.caseId!==p.caseId)throw new Error('Candidate identity changed');
    inspectDiagnosticExecution(r,{arm:c.arm,snapshot:testCase.snapshot,messages:p.messages,model:run.model});
    const units=auditUnits(testCase.snapshot).filter(u=>u.target).map(u=>{
      const expected=testCase.reference.issues.find(i=>i.unitId===u.id)?.verdict||'retain';
      const actual=r.diagnostic?.checks.find(k=>k.unitId===u.id)?.verdict||null;
      return {unitId:u.id,expected,actual,referenceAgreement:actual===null?null:actual===expected};
    });
    return {id:c.id,caseId:c.caseId,arm:c.arm,split:testCase.split,status:r.status,units,allUnitsAgree:r.status==='diagnosed'?units.every(u=>u.referenceAgreement):null};
  });
  return {mode:run.mode,rows,totals:diagnosticTotals(run.candidates),byArm:Object.fromEntries(arms.map(arm=>[arm,diagnosticTotals(run.candidates.filter(c=>c.arm===arm))])),qualityConclusion:null,semanticJudgment:'unverified',limitations:run.plan.limitations};
}
export function meaningMarkdown(run) {
  const r=inspectMeaning(run);
  return `# 解释与计算含义：单项后缀实验\n\n${run.mode==='live'?'真实诊断，尚待独立语义审阅。':'离线模拟：0 次真实模型调用，没有质量成绩。'}\n\n| 案例 | 类型 | 组别 | 执行 | 全部单元与开发参考一致 | 不一致单元（参考 → 实际） |\n| --- | --- | --- | --- | --- | --- |\n${r.rows.map(row=>`| ${row.caseId} | ${row.split} | ${row.arm} | ${row.status} | ${row.allUnitsAgree??'未接受诊断'} | ${row.units.filter(u=>u.referenceAgreement!==true).map(u=>`${u.unitId}: ${u.expected} → ${u.actual||'无有效诊断'}`).join('; ')||'—'} |`).join('\n')}\n\n| 组别 | 实际请求 | 输入 tokens | 输出 tokens | 执行失败 |\n| --- | --- | --- | --- | --- |\n${Object.entries(r.byArm).map(([arm,t])=>`| ${arm} | ${t.calls} | ${t.promptTokens??'未报告'} | ${t.completionTokens??'未报告'} | ${t.failures} |`).join('\n')}\n\n${r.limitations.map(l=>`- ${l}`).join('\n')}\n`;
}
