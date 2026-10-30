import test from 'node:test';
import assert from 'node:assert/strict';
import { lectureAnchors } from '../evals/lectures/cases.mjs';
import { noteBlocks } from '../shared/note-format.mjs';
import { renderMath } from '../shared/math.mjs';
import { freshTemplateLibrary, templateSnapshot, templateLibrarySchema } from '../shared/writing-templates.mjs';
import prior from '../shared/lecture-legacy-v1.json' with { type: 'json' };
import { buildMessages, validateResult } from '../server/harness.mjs';
import { buildNoteReview, noteReviewTriggers } from '../server/note-review.mjs';
import { isLectureSynthesis } from '../shared/lecture-synthesis.mjs';

const input = () => ({ action:'generate', scope:'chapter', chapterId:'c1', revision:0, instruction:'整理当前主题',
  learning:{mode:'adaptive',template:'guided-v3',writingTemplate:templateSnapshot(freshTemplateLibrary(),'lecture')},
  document:{title:'复习讲义',intent:'掌握概念、原理与方法',chapters:[{id:'c1',title:'完整主题',sourcePages:[1],content:{type:'doc',content:[]}}],pages:[{number:1,text:'用于离线路由与渲染检查的自制来源。'}]} });

test('v1 lecture defaults migrate idempotently while authored preferences, undo and existing notebook snapshots survive', () => {
  const old=freshTemplateLibrary();Object.assign(old.templates[1],structuredClone(prior),{personalSample:structuredClone(prior.defaultSample),selectedSample:'personal',editCount:3});
  old.templates[1].personalSample.paragraphs[0].text+=' 用户自己的偏好。';
  old.templates[1].undo={selectedSample:'default',personalSample:structuredClone(prior.defaultSample),editCount:0};old.revision=11;
  const frozen=structuredClone(old), notebookSnapshot={...templateSnapshot(freshTemplateLibrary(),'lecture'),organization:prior.organization,sample:structuredClone(prior.defaultSample)};
  const next=templateLibrarySchema.parse(old);
  assert.deepEqual(next.templates[1].defaultSample,freshTemplateLibrary().templates[1].defaultSample);
  for(const field of ['personalSample','selectedSample','editCount','undo'])assert.deepEqual(next.templates[1][field],old.templates[1][field]);
  assert.equal(next.revision,11);assert.deepEqual(templateLibrarySchema.parse(next),next);assert.deepEqual(old,frozen);
  const request=input();request.learning.writingTemplate=notebookSnapshot;
  const messages=buildMessages(request);assert.deepEqual(JSON.parse(messages[1].content).writingTemplate,notebookSnapshot);
  assert.match(messages[0].content,/lecture-synthesis-v3/);
  old.templates[1].editCount=0;old.templates[1].personalSample=structuredClone(prior.defaultSample);
  assert.deepEqual(templateLibrarySchema.parse(old).templates[1].personalSample,next.templates[1].defaultSample);
  old.templates[1].defaultSample.paragraphs[0].text+=' forged';assert.throws(()=>templateLibrarySchema.parse(old),/内置模板/);
});

test('lecture defaults keep one contract across writing and review, never enforce extra headings or routine review calls', () => {
  const request=input(),messages=buildMessages(request),before=structuredClone(request);
  assert.equal(messages[0].content.split('lecture-synthesis-v3').length-1,1);
  const candidate=validateResult(request,{blocks:[
    {type:'paragraph',text:'先明确描述中心还是波动。',sourcePages:[1]},
    {type:'paragraph',text:'偏差相加会抵消，平方偏差保留大小。',sourcePages:[1]},
    {type:'paragraph',text:'选择样本口径后，再计算方差与标准差。',sourcePages:[1]},
  ]});
  assert.equal(candidate.blocks.length,3);assert.deepEqual(noteReviewTriggers(request,candidate),[]);
  const review=buildNoteReview(request,candidate)[0].content;
  assert.match(review,/lecture-synthesis-v3/);assert.match(review,/讲义编辑审核/);assert.match(review,/不因短而要求变长/);
  assert.deepEqual(request,before);
});

test('exercise, translation and narrative tasks do not acquire lecture synthesis merely from a previous lecture template', () => {
  for(const goal of ['逐题解答，并给出过程和答案','只给提示，不给答案','只翻译']){
    const request=input();request.document.intent=goal;
    assert.equal(isLectureSynthesis(request),false,goal);
  }
  const request=input();request.learning.mode='translation';
  assert.doesNotMatch(buildMessages(request)[0].content,/lecture-synthesis-v3/);
  request.learning.mode='adaptive';request.learning.writingTemplate=templateSnapshot(freshTemplateLibrary(),'narrative');
  assert.doesNotMatch(buildMessages(request)[0].content,/lecture-synthesis-v3/);
});

test('development anchors compile through production note/math rendering; this is not a model-quality score', () => {
  let formulas=0;
  const visit=node=>{if(node.type==='math'){assert.ok(renderMath(node.attrs.latex,node.attrs.display));formulas++;}(node.content||[]).forEach(visit);};
  for(const anchor of lectureAnchors){assert.equal(anchor.origin,'project-authored');anchor.paragraphs.flatMap(p=>noteBlocks(p.text,{}, {strict:true})).forEach(visit);}
  assert.ok(formulas>30);
});

test('authored worked examples have independently reproducible arithmetic and algorithm boundaries', () => {
  const xs=[2,4,6],mean=xs.reduce((a,b)=>a+b)/xs.length,sum=xs.reduce((n,x)=>n+(x-mean)**2,0);
  assert.equal(mean,4);assert.equal(sum,8);assert.equal(sum/(xs.length-1),4);assert.equal((2+4+60)/3,22);
  assert.ok(Math.abs((1-.95**20)-.642)<.001);
  const p=[.008,.018,.04,.2],q=.05;
  assert.equal(p.filter(x=>x<=q/p.length).length,1);
  assert.equal(p.reduce((k,x,i)=>x<=(i+1)*q/p.length?i+1:k,0),2);
  const bound=(a,t,strict=false)=>{let l=0,r=a.length;while(l<r){const m=l+Math.floor((r-l)/2);if(strict?a[m]<=t:a[m]<t)l=m+1;else r=m;}return l;};
  assert.equal(bound([1,3,3,7],3),1);assert.equal(bound([1,3,3,7],3,true),3);
  for(const a of [[],[3],[1,3,3,7]])for(const t of [-1,1,3,7,9])for(const strict of [false,true]){
    const expected=a.findIndex(x=>strict?x>t:x>=t);assert.equal(bound(a,t,strict),expected<0?a.length:expected);
  }
});
