import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { root } from './lib/process.mjs';
import { planField, runField, inspectField } from '../evals/claims/field/experiment.mjs';
import { createFieldReview, summarizeFieldReview } from '../evals/claims/field/review.mjs';
import { fieldReviewHTML } from '../evals/claims/field/page.mjs';

const {values}=parseArgs({options:{demo:{type:'boolean'},live:{type:'boolean'},case:{type:'string'},out:{type:'string'},inspect:{type:'string'},summarize:{type:'string'},review:{type:'string'}}});
if([values.demo,values.live,values.inspect,values.summarize].filter(Boolean).length>1)throw Error('Choose one execution mode');
if(values.review&&!values.summarize)throw Error('--review requires --summarize');
if(values.summarize&&!values.review)throw Error('--summarize requires --review');
if((values.inspect||values.summarize)&&values.case)throw Error('Read-only mode does not select generation cases');
if(values.case&&values.case!=='openintro-mean')throw Error('This frozen trial only supports openintro-mean');
if(values.live&&values.case!=='openintro-mean')throw Error('Live execution requires explicit --case openintro-mean');
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
async function directory(label) {
  const path=values.out?resolve(values.out):join(root,'artifacts/field-review',`${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${label}`);
  await mkdir(resolve(path,'..'),{recursive:true});await mkdir(path);return path;
}
async function artifacts(path,run) {
  const report=inspectField(run),pack=createFieldReview(run);
  await save(join(path,'run.json'),run);await save(join(path,'report.json'),report);await save(join(path,'packet.json'),pack.packet);
  await save(join(path,'review.template.json'),pack.review);await save(join(path,'summary.json'),summarizeFieldReview(run,pack.review));
  await writeFile(join(path,'review.html'),fieldReviewHTML(pack));
  console.log(JSON.stringify({status:report.status,calls:report.calls,units:report.coverage.length,windows:report.windows,failedWindows:report.failedWindows}));
  console.log(`Open: ${join(path,'review.html')}`);return report;
}
if(values.inspect||values.summarize) {
  const run=JSON.parse(await readFile(resolve(values.inspect||values.summarize),'utf8'));inspectField(run);
  if(values.summarize) {
    const review=JSON.parse(await readFile(resolve(values.review),'utf8')),report=summarizeFieldReview(run,review),path=await directory('summary');
    await save(join(path,'review.json'),review);await save(join(path,'summary.json'),report);console.log(`Review: ${report.status}; ${path}`);
    if(report.status==='awaiting-human-review')process.exitCode=1;
  }else await artifacts(await directory('replay'),run);
  console.log('Read-only; 0 model calls.');
}else {
  const plan=planField(),path=await directory(values.live?'live':values.demo?'demo':'plan');
  let gitRevision=null,gitDirty=null;try {
    gitRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim();
    gitDirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim();
  }catch{}
  await save(join(path,'plan.json'),{plan,gitRevision,gitDirty});console.log(`Plan: <= ${plan.maxCalls} calls / ${plan.maxCompletionTokens} output tokens; input tokens additional.`);
  if(!values.live&&!values.demo)console.log(`No model calls: ${path}`);
  else {
    let config;if(values.live){try{process.loadEnvFile(join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}config={apiKey:process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL,baseUrl:process.env.DEEPSEEK_BASE_URL};}
    const run=await runField(plan,{mode:values.live?'live':'simulation',config,gitRevision,gitDirty,onStage:async run=>{await save(join(path,'checkpoint.json'),run);console.log(`generation: ${run.generation.status}; reviewed windows: ${run.reviews.length}`);}});
    const report=await artifacts(path,run);if(report.status!=='awaiting-human-review')process.exitCode=1;
    console.log(values.live?'No automatic quality score or note edit. Human review remains empty.':'Simulation only; 0 real model calls.');
  }
}
