import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {courseCase,courseOracle} from '../evals/lectures/course-case.mjs';
import {planCourseExperiment,runCourseArm,hash} from '../evals/lectures/experiment.mjs';
import {createCourseReview,reviewHTML,costHTML,validateCourseRatings} from '../evals/lectures/review.mjs';
import {courseSimulator} from '../evals/lectures/simulation.mjs';

const {values}=parseArgs({options:{'baseline-root':{type:'string'},'candidate-root':{type:'string'},out:{type:'string'},plan:{type:'string'},live:{type:'boolean'},demo:{type:'boolean'},summarize:{type:'string'},review:{type:'string'}}});
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
if(values.summarize){
  if(!values.review||values.live||values.demo||values.plan)throw new Error('Use --summarize packet.json --review ratings.json');
  console.log(JSON.stringify(validateCourseRatings(await read(values.summarize),await read(values.review))));
}else{
  if(values.live&&values.demo)throw new Error('Choose --live or --demo');
  if((values.live||values.demo)&&!values.plan)throw new Error('Freeze --baseline-root / --candidate-root first; execution requires --plan');
  if(values.plan&&(values['baseline-root']||values['candidate-root']))throw new Error('Cannot change roots of a frozen plan');
  if(!values.plan&&(!values['baseline-root']||!values['candidate-root']))throw new Error('Provide both runtime snapshot roots');
  const plan=values.plan?await read(resolve(values.plan)):await planCourseExperiment(courseCase,{baseline:values['baseline-root'],candidate:values['candidate-root']});
  if(plan.caseHash!==hash(courseCase)||hash(plan.testCase)!==plan.caseHash)throw new Error('Case changed; freeze a new plan');
  const output=resolve(values.out||`artifacts/course-eval/${Date.now()}-${values.live?'live':values.demo?'demo':'plan'}`);
  await mkdir(resolve(output,'..'),{recursive:true});await mkdir(output); // never overwrite or silently resume a paid run
  await save(join(output,'plan.json'),plan);
  if(!values.live&&!values.demo)console.log(JSON.stringify({status:'planned',output,liveModelCalls:0,budgetPerArm:plan.budget}));
  else{
    let config={apiKey:'offline-fixture',baseUrl:'https://api.deepseek.com',model:'simulation-only'};
    if(values.live){
      try{process.loadEnvFile(resolve('.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
      config={apiKey:process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL,baseUrl:process.env.DEEPSEEK_BASE_URL};
      if(!config.apiKey||!config.model||!config.baseUrl)throw new Error('Configure DEEPSEEK_API_KEY, DEEPSEEK_MODEL and DEEPSEEK_BASE_URL in local .env');
    }
    process.env.READING_TREE_DIAGNOSTIC_DIR=join(output,'diagnostics');
    const results=[];
    for(const arm of plan.order){
      const result=await runCourseArm(plan,arm,{config,mode:values.demo?'simulation':'live',
        ...(values.demo?{fetcher:courseSimulator(plan.testCase,{legacy:arm==='baseline'})}:{}),
        onSave:async r=>{const path=join(output,`${arm}.json`);await save(path+'.pending',r);await rename(path+'.pending',path);},
        onProgress:info=>console.log(JSON.stringify(info))});
      results.push(result);if(result.markdown)await writeFile(join(output,`${arm}.md`),result.markdown);
      console.log(JSON.stringify({arm,status:result.status,chapters:result.chapters.length,usage:result.usage,failure:result.failure}));
    }
    const {packet,mapping,review}=createCourseReview(plan,results,courseOracle);
    await save(join(output,'review-packet.json'),packet);await save(join(output,'private-mapping.json'),mapping);await save(join(output,'review.template.json'),review);
    await writeFile(join(output,'review.html'),reviewHTML(packet));await writeFile(join(output,'cost.html'),costHTML(plan,results,mapping));
    await save(join(output,'summary.json'),{status:values.demo?'simulation-only':'awaiting-review',planHash:hash(plan),results:results.map(r=>({arm:r.arm,resultHash:hash(r),status:r.status,chapters:r.chapters.length,usage:r.usage,failure:r.failure})),qualityConclusion:null,limitations:plan.limitations});
    console.log(JSON.stringify({output,status:values.demo?'simulation-only':'awaiting-review',realCalls:values.demo?0:results.reduce((n,r)=>n+r.trace.length,0)}));
    if(results.some(r=>r.status!=='complete'))process.exitCode=1;
  }
}
