import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { root } from './lib/process.mjs';
import { planClaims, runClaims, inspectClaims, claimsMarkdown, claimsHTML } from '../evals/claims/experiment.mjs';
import { planComparison, runComparison, inspectComparison, comparisonMarkdown, comparisonHTML } from '../evals/claims/v2/experiment.mjs';
import { planFocused, runFocused, inspectFocused, focusedMarkdown, focusedHTML } from '../evals/claims/focused/experiment.mjs';
import { planMeaning, runMeaning, inspectMeaning, meaningMarkdown } from '../evals/claims/meaning/experiment.mjs';
import { planCalculation, runCalculationExperiment, inspectCalculation, calculationMarkdown } from '../evals/claims/calculation/experiment.mjs';

const {values}=parseArgs({options:{demo:{type:'boolean'},live:{type:'boolean'},compare:{type:'boolean'},focused:{type:'boolean'},meaning:{type:'boolean'},calculation:{type:'boolean'},case:{type:'string',multiple:true},out:{type:'string'},inspect:{type:'string'}}});
if(values.demo&&values.live)throw new Error('Choose --demo or --live');
if([values.compare,values.focused,values.meaning,values.calculation].filter(Boolean).length>1)throw new Error('Choose one review experiment');
if(values.inspect&&(values.demo||values.live||values.case||values.compare||values.focused||values.meaning||values.calculation))throw new Error('--inspect is read-only and detects protocol from the artifact');
if(values.live&&!values.case?.length)throw new Error('Live runs require --case; no implicit paid matrix');
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const inspect=run=>run.schema===5?inspectCalculation(run):run.schema===4?inspectMeaning(run):run.schema===3?inspectFocused(run):run.schema===2?inspectComparison(run):inspectClaims(run);
const markdown=run=>run.schema===5?calculationMarkdown(run):run.schema===4?meaningMarkdown(run):run.schema===3?focusedMarkdown(run):run.schema===2?comparisonMarkdown(run):claimsMarkdown(run);
const html=run=>run.schema===3?focusedHTML(run):run.schema===2?comparisonHTML(run):claimsHTML(run);
async function newDirectory(path) {
  await mkdir(resolve(path,'..'),{recursive:true});await mkdir(path); // Existing evidence never overwritten.
}
async function artifacts(directory,run) {
  const report=inspect(run);await save(join(directory,'run.json'),run);
  await save(join(directory,'report.json'),report);
  await writeFile(join(directory,'report.md'),markdown(run));
  if(run.schema<4)await writeFile(join(directory,'review.html'),html(run));
  console.log(`Open: ${join(directory,run.schema>=4?'report.md':'review.html')}`);
  return report;
}
if(values.inspect) {
  const run=JSON.parse(await readFile(resolve(values.inspect),'utf8'));
  console.log(markdown(run));
  if(values.out){const directory=resolve(values.out);await newDirectory(directory);await artifacts(directory,run);}
  console.log('Read-only replay; 0 model calls.');
} else {
  const plan=(values.calculation?planCalculation:values.meaning?planMeaning:values.focused?planFocused:values.compare?planComparison:planClaims)(values.case);
  const directory=values.out?resolve(values.out):join(root,'artifacts/claim-eval',`${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${values.demo?'demo':values.live?'live':'plan'}`);
  await newDirectory(directory);
  let gitRevision=null,gitDirty=null;
  try {
    gitRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim();
    gitDirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim();
  }catch{}
  await save(join(directory,'plan.json'),{plan,gitRevision,gitDirty});
  console.log(`Plan: ${plan.cases.length} cases; <= ${plan.maxCalls} provider calls, <= ${plan.maxCompletionTokens} output tokens; input tokens additional.`);
  if(!values.demo&&!values.live)console.log(`No model calls. Plan: ${directory}`);
  else {
    let config;
    if(values.live) {
      try{process.loadEnvFile(join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
      config={apiKey:process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL,baseUrl:process.env.DEEPSEEK_BASE_URL};
    }
    const run=await (values.calculation?runCalculationExperiment:values.meaning?runMeaning:values.focused?runFocused:values.compare?runComparison:runClaims)(plan,{mode:values.live?'live':'simulation',config,gitRevision,gitDirty,onStage:async(run,candidate)=>{
      await save(join(directory,'checkpoint.json'),run);
      console.log(`${candidate.id}: ${candidate.result.status}`);
    }});
    const report=await artifacts(directory,run);
    console.log(values.live?(values.focused||values.meaning||values.calculation?'Diagnostics only; independent semantic review still required.':'Proposals only; independent semantic review still required.'):'Simulation only; 0 real provider calls.');
    if(report.totals.failed||report.totals.failures)process.exitCode=1;
  }
}
