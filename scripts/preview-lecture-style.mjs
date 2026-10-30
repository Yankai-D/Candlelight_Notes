import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {lectureAnchors,lectureRubric} from '../evals/lectures/cases.mjs';
import {noteBlocks} from '../shared/note-format.mjs';
import {printHTML} from '../server/print-document.mjs';
import {openPrintPage} from '../server/pdf-export.mjs';
import {progression} from '../evals/lectures/progression.mjs';

const progressive=process.argv.includes('--progression');
const anchors=progressive?progression.sections.map((section,i)=>({id:`stage-${i+1}`,title:section.title,goal:section.purpose,paragraphs:progression.prose[i].map(text=>({text})),checks:progression.humanReview,avoid:'将同一例题的新教学用途当成重复删除。'})):lectureAnchors;
const output=resolve(progressive?'artifacts/lecture-progression-v1':'artifacts/lecture-style-v3');await mkdir(output,{recursive:true});
const document={title:'复习讲义风格样稿',subtitle:'原创开发样稿，用于检查组织、密度与解释深度；不是模型生成质量的评测结果。',intent:'查看三个不同知识任务的统一讲义风格。',demo:true,entryType:'note',notebookLabel:'风格基准 v3',pages:[],
 chapters:anchors.map(anchor=>({id:anchor.id,title:anchor.title,subtitle:anchor.goal,sourcePages:[],content:{type:'doc',content:anchor.paragraphs.flatMap(p=>noteBlocks(p.text,{}, {strict:true}))}}))};
await writeFile(join(output,'samples.html'),await printHTML(document));
const {browser,page}=await openPrintPage(document);
let layout;
try{
 layout=await page.evaluate(()=>({chapters:document.querySelectorAll('.flow-chapter').length,math:document.querySelectorAll('.math-inline,.math-display').length,horizontalOverflow:document.documentElement.scrollWidth>innerWidth}));
 if(layout.horizontalOverflow)throw new Error('Sample layout overflows');
 await page.screenshot({path:join(output,'samples.png'),fullPage:true});
 for(const element of await page.$$('.flow-chapter')){
   const id=await element.evaluate(node=>node.getAttribute('data-note-chapter'));
   await element.screenshot({path:join(output,`${id}.png`)});
 }
}finally{await browser.close();}
const report={schema:'lecture-style-development-v3',status:'rendered',origin:'project-authored',liveModelCalls:0,modelQualityConclusion:null,layout,
 rubric:lectureRubric,anchors:anchors.map(({id,goal,checks,avoid})=>({id,goal,checks,avoid})),reviewState:'authored-and-locally-reviewed; awaiting live generation comparison'};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,layout,modelQualityConclusion:null}));
