import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { root } from './lib/process.mjs';
import { planExperiment, runExperiment } from '../evals/notes/experiment.mjs';
import { createReview, reviewHTML, summarizeReview } from '../evals/notes/review.mjs';
import { inspectRun, diagnosticsMarkdown, validateFindings } from '../evals/notes/diagnostics.mjs';

const {values}=parseArgs({options:{demo:{type:'boolean'},live:{type:'boolean'},suite:{type:'string'},case:{type:'string',multiple:true},arm:{type:'string',multiple:true},repeats:{type:'string'},out:{type:'string'},summarize:{type:'string'},review:{type:'string'},inspect:{type:'string'},findings:{type:'string'}}});
if(values.demo&&values.live) throw new Error('Choose --demo or --live');
if(values.inspect&&(values.demo||values.live||values.suite||values.summarize||values.case||values.arm||values.repeats||values.review)) throw new Error('--inspect is read-only and cannot be combined with generation or scoring options');
if(values.findings&&!values.inspect) throw new Error('--findings requires --inspect');
const save=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
async function newDirectory(directory) {
  // Refuse to overwrite previous evidence or silently resume a paid run.
  await mkdir(directory,{recursive:false}).catch(async error=>{
    if(error.code!=='ENOENT')throw error;
    await mkdir(resolve(directory,'..'),{recursive:true});await mkdir(directory);
  });
}
async function writeArtifacts(directory,run) {
  const {packet,review,mapping}=createReview(run),diagnostics=inspectRun(run);
  await save(join(directory,'private-run.json'),run);await save(join(directory,'private-mapping.json'),mapping);
  await save(join(directory,'review-packet.json'),packet);await save(join(directory,'review.template.json'),review);
  await save(join(directory,'summary.json'),summarizeReview(run,review));
  await save(join(directory,'diagnostics.json'),diagnostics);
  await writeFile(join(directory,'diagnostics.md'),diagnosticsMarkdown(diagnostics));
  await writeFile(join(directory,'review.html'),reviewHTML(packet,review));
  console.log(`Open: ${join(directory,'review.html')}`);
}
if(values.inspect) {
  const run=JSON.parse(await readFile(resolve(values.inspect),'utf8'));
  const report=inspectRun(run);
  if(values.findings) {
    const findings=JSON.parse(await readFile(resolve(values.findings),'utf8'));
    console.log(JSON.stringify(validateFindings(run,findings)));
  }
  console.log(diagnosticsMarkdown(report));
  if(values.out) {
    const directory=resolve(values.out);await newDirectory(directory);
    await save(join(directory,'plan.json'),{...run.plan,gitRevision:run.gitRevision,gitDirty:run.gitDirty});
    await writeArtifacts(directory,run);
    console.log('仅从历史记录重建审阅页；本次模型调用 0 次，原始运行文件未修改。');
  }
  if(!report.recordedLimitsPassed||report.missingCandidates.length) process.exitCode=1;
} else if(values.summarize) {
  if(!values.review) throw new Error('Provide --review path/to/review.json');
  const directory=resolve(values.summarize),run=JSON.parse(await readFile(join(directory,'private-run.json'),'utf8'));
  const review=JSON.parse(await readFile(resolve(values.review),'utf8'));
  const report=summarizeReview(run,review);await save(join(directory,'summary.json'),report);
  console.log(`Review status: ${report.status}; ${join(directory,'summary.json')}`);
  if(report.status==='awaiting-human-review') process.exitCode=1;
} else {
  if(values.live&&!values.case?.length) throw new Error('Live runs require --case; never implicitly run the whole matrix.');
  const plan=planExperiment({suite:values.suite,materialIds:values.case,selectedArms:values.arm,repeats:values.repeats?Number(values.repeats):1});
  const directory=values.out?resolve(values.out):join(root,'artifacts/note-eval',`${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${values.demo?'demo':values.live?'live':'plan'}`);
  await newDirectory(directory);
  let revision=null,dirty=null;try{
    revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    dirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  }catch{}
  await save(join(directory,'plan.json'),{...plan,gitRevision:revision,gitDirty:dirty});
  console.log(`Plan: ${plan.candidateCount} candidates; per candidate <= ${plan.budget.maxCalls} calls, <= ${plan.budget.totalCompletionTokens} output tokens. Input tokens are additional.`);
  if(!values.demo&&!values.live) console.log(`No model calls. Frozen plan: ${directory}`);
  else {
    let config;
    if(values.live) {
      try{process.loadEnvFile(resolve(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
      config={apiKey:process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL,baseUrl:process.env.DEEPSEEK_BASE_URL};
    }
    const run=await runExperiment(plan,{mode:values.live?'live':'simulation',config,onCandidate:async(run,candidate)=>{
      await save(join(directory,'checkpoint.json'),run);
      console.log(`${candidate.caseId} ${candidate.arm}: ${candidate.status}`);
    }});
    run.gitRevision=revision;
    run.gitDirty=dirty;
    await writeArtifacts(directory,run);
    console.log(values.live?'等待人工审阅；没有自动质量结论。':'模拟数据；真实模型调用 0 次，没有质量分数或优势结论。');
    if(run.candidates.some(candidate=>candidate.status==='failed'))process.exitCode=1;
  }
}
