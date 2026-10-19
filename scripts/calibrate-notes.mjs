import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { root } from './lib/process.mjs';
import { createCalibrationPack, verifyFrozen, assessCalibration, runCalibrationRegressions } from '../evals/notes/calibration/suite.mjs';
import { calibrationHTML } from '../evals/notes/calibration/page.mjs';

// No model config, env loading, provider option or live mode exists here.
const {values}=parseArgs({options:{out:{type:'string'},summarize:{type:'string'},review:{type:'string'}}});
const save=(path,data)=>writeFile(path,JSON.stringify(data,null,2)+'\n');
if(values.summarize) {
  if(!values.review||values.out)throw new Error('Use --summarize <pack-directory> --review <review.json>');
  const directory=resolve(values.summarize),pack=verifyFrozen(JSON.parse(await readFile(join(directory,'corpus.json'),'utf8')));
  const result=assessCalibration(pack,JSON.parse(await readFile(resolve(values.review),'utf8')));
  // Never overwrite a previous review discussion; each summary is separate.
  const file=join(directory,`review-summary-${Date.now()}.json`);await writeFile(file,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(`${result.status}; ${result.disagreements.length} records differ from the development reference. ${file}`);
  if(result.missing.length)process.exitCode=1;
}else {
  if(values.review)throw new Error('--review requires --summarize');
  const directory=values.out?resolve(values.out):join(root,'artifacts/calibration',new Date().toISOString().replaceAll(/[:.]/g,'-'));
  await mkdir(resolve(directory,'..'),{recursive:true});await mkdir(directory);
  const pack=createCalibrationPack(),regression=await runCalibrationRegressions();
  let revision=null,dirty=null;try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  await save(join(directory,'corpus.json'),pack.frozen);await save(join(directory,'packet.json'),pack.packet);await save(join(directory,'answer-key.json'),pack.answers);
  await save(join(directory,'review.template.json'),pack.review);await save(join(directory,'regressions.json'),regression);
  await save(join(directory,'manifest.json'),{version:pack.packet.version,corpusHash:pack.packet.corpusHash,gitRevision:revision,gitDirty:dirty,caseCount:pack.packet.tasks.length,candidateCount:pack.packet.records.length,referenceStatus:pack.packet.provenance.reviewStatus,actualModelCalls:0,qualityConclusion:null});
  await writeFile(join(directory,'calibration.html'),calibrationHTML(pack));
  console.log(`${regression.passed?'PASS':'FAIL'}: ${pack.packet.tasks.length} calibration cases / ${pack.packet.records.length} authored notes / ${regression.checks.length} mechanical regressions. Actual model calls: 0.`);
  console.log(`Open: ${join(directory,'calibration.html')}`);
  console.log('Development references await independent review. No model quality score is produced.');
  if(!regression.passed)process.exitCode=1;
}
