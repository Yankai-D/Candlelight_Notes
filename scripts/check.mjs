import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { sourceEvidence, sha256 } from './lib/source-evidence.mjs';
import { doctor } from './doctor.mjs';
import { root, runNode } from './lib/process.mjs';
const { values } = parseArgs({ options: { out: { type: 'string' }, 'require-clean': { type: 'boolean' } } });
const directory=resolve(root,values.out || 'artifacts/check');
const within=relative(join(root,'artifacts'),directory);
if(!within || within.startsWith('..') || resolve(join(root,'artifacts'),within)!==directory) throw new Error('Check output must be under artifacts');
await mkdir(dirname(directory),{recursive:true});await mkdir(directory,{recursive:!values.out});
const report={schema:'engineering-check-v2',startedAt:new Date().toISOString(),status:'running',environment:null,source:null,stages:[]};
try {
  report.source=await sourceEvidence(root);
  if(values['require-clean'] && report.source.status) throw new Error('Release verification requires a clean Git checkout');
  report.environment=await doctor();
  const stages=[['types',['node_modules/typescript/bin/tsc','-b']],['build',['node_modules/vite/bin/vite.js','build']],
    ['tests',['scripts/test.mjs']],['browser',['scripts/test-browser.mjs']],['harness-demo',['scripts/demo-harness.mjs']],
    ['note-eval-demo',['scripts/evaluate-notes.mjs','--demo']],['note-calibration',['scripts/calibrate-notes.mjs']],
    ['claim-eval-demo',['scripts/evaluate-claims.mjs','--demo']],['claim-comparison-demo',['scripts/evaluate-claims.mjs','--compare','--demo']],
    ['claim-focused-demo',['scripts/evaluate-claims.mjs','--focused','--demo']],['claim-meaning-demo',['scripts/evaluate-claims.mjs','--meaning','--demo']],
    ['claim-calculation-demo',['scripts/evaluate-claims.mjs','--calculation','--demo']],['field-review-demo',['scripts/evaluate-field.mjs','--demo']],
    ['product-evidence',['scripts/snapshot-product-evidence.mjs']]];
  for(const [name,args] of stages) {
    console.log(`\n[check] ${name}`);
    const stage={name,status:'running',startedAt:Date.now(),elapsedMs:0};report.stages.push(stage);
    try { await runNode(args,{log:join(directory,`${name}.log`)});stage.status='pass'; }
    catch(error) {stage.status='fail';stage.error=error.message;throw error;}
    finally {stage.elapsedMs=Date.now()-stage.startedAt;try {stage.logSha256=sha256(await readFile(join(directory,`${name}.log`)));} catch { /* stage may fail before opening its log */ }}
  }
  report.status='pass';
} catch(error) { report.status='fail';report.error=error.message;process.exitCode=1;console.error(error.message); }
finally {
  report.finishedAt=new Date().toISOString();
  try {
    report.sourceAfter=await sourceEvidence(root);
    if(report.source?.fingerprint!==report.sourceAfter.fingerprint || report.source?.revision!==report.sourceAfter.revision) {
      report.status='fail';report.error='Source changed during verification';process.exitCode=1;
    }
  } catch(error) {report.status='fail';report.error=error.message;process.exitCode=1;}
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  if(report.status==='pass') console.log(`\n所有检查通过。报告：${relative(root,directory)}/report.json`);
  else console.error(`\n检查未通过：${report.error}。报告：${relative(root,directory)}/report.json`);
}
