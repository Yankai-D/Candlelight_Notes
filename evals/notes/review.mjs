import { hash, artifactHash, experimentLimitations } from './experiment.mjs';
import { renderNoteHTML, escapeHTML as esc } from '../../shared/note-html.mjs';
import { noteBlocks } from '../../shared/note-format.mjs';
import { reviewPrintCSS, prepareReviewPrint } from './print.mjs';

export const rubric = [
  {id:'faithfulness',label:'事实与条件',description:'定义、数值、公式、适用条件和来源归属准确；补充不伪装成原文结论。'},
  {id:'coverage',label:'实质覆盖',description:'在任务范围内保留核心论证与限制，不靠省略难点换取流畅；小纸条覆盖追问所需内容，不要求重讲整章。'},
  {id:'reasoning',label:'推理与主线',description:'说明局部计算为什么必要、依据是什么、结果怎样回到问题。'},
  {id:'organization',label:'组织与文风',description:'长文自然连贯，讲义单元层次明确；稳定书面文风，避免栏目拼接、导读或提纲。'},
  {id:'goal',label:'学习目标',description:'重点回应给定目标，不臆造额外任务，也不借目标删掉实质内容。'},
  {id:'adaptation',label:'铺垫深度',description:'陌生概念有必要衔接，已知知识适当收束，核心事实和文风不变。'},
];
export const anchors = ['0 · 无法使用／实质错误','1 · 存在重大缺陷','2 · 部分达标，仍需明显修改','3 · 达到本次要求','4 · 表现突出且有具体依据'];
const candidateText = candidate => candidate.result?.paragraphs
  ? [candidate.result.title,...candidate.result.paragraphs].filter(Boolean).join('\n\n')
  : (candidate.result?.blocks||[]).flatMap(block=>block.items||[block.text]).filter(Boolean).join('\n\n');
function verifyRun(run) {
  if(run.planHash!==hash(run.plan)||run.artifactHash!==artifactHash(run)) throw new Error('Run artifact hash mismatch');
}

export function createReview(run) {
  verifyRun(run);
  const mapping={},records=[];
  for(const candidate of run.candidates) {
    // Same labels across profiles of one material/repeat: enables meaningful
    // cross-profile review without revealing treatment identity.
    const shuffled=[...run.plan.selectedArms].sort((a,b)=>hash([run.id,candidate.materialId,candidate.repeat,a]).localeCompare(hash([run.id,candidate.materialId,candidate.repeat,b])));
    const label=String.fromCharCode(65+shuffled.indexOf(candidate.arm));
    const id=`${candidate.caseId}/${candidate.repeat}/${label}`;mapping[id]=candidate.id;
    records.push({id,caseId:candidate.caseId,materialId:candidate.materialId,profileId:candidate.profileId,repeat:candidate.repeat,label,status:candidate.status,title:candidate.result?.title,text:candidateText(candidate),blocks:candidate.result?.rendering?.blocks||[]});
  }
  records.sort((a,b)=>a.id.localeCompare(b.id));
  const packet={version:'note-review-v1',runId:run.id,artifactHash:run.artifactHash,mode:run.mode,rubric,anchors,limitations:experimentLimitations(run.plan),
    cases:run.plan.cases.map(({id,materialId,profileId,material,request})=>({id,materialId,profileId,material,profile:request.knowledge,organization:request.learning.writingTemplate.organization})),records};
  const review={version:packet.version,runId:run.id,artifactHash:run.artifactHash,rubricHash:hash(rubric),reviewer:'',reviewedAt:'',
    records:records.filter(record=>record.status==='accepted').map(record=>({id:record.id,criticalReview:null,criticalErrors:[],ratings:Object.fromEntries(rubric.map(d=>[d.id,{score:null,quote:'',reason:''}]))})),
    profilePairs:[]};
  for(const materialId of new Set(records.map(record=>record.materialId))) for(let repeat=1;repeat<=run.plan.repeats;repeat++) for(const label of new Set(records.map(record=>record.label))) {
    const pair=records.filter(record=>record.materialId===materialId&&record.repeat===repeat&&record.label===label&&record.status==='accepted');
    if(pair.length===2) review.profilePairs.push({id:`${materialId}/${repeat}/${label}`,recordIds:pair.map(record=>record.id),stableVoice:null,preservedFacts:null,appropriateDepth:null,quotes:Object.fromEntries(pair.map(record=>[record.id,''])),reason:''});
  }
  return {packet,review,mapping};
}

export function summarizeReview(run, review) {
  const {packet,mapping}=createReview(run);
  if(review.runId!==run.id||review.artifactHash!==run.artifactHash||review.version!==packet.version) throw new Error('Review belongs to a different run');
  if(review.rubricHash && review.rubricHash!==hash(rubric)) throw new Error('Review rubric changed; review the frozen outputs again');
  const base={runId:run.id,mode:run.mode,candidateCount:run.candidates.length,failedCount:run.candidates.filter(c=>c.status==='failed').length,
    mechanical:run.candidates.map(({id,status,usage,evidence})=>({id,status,usage,evidence})),limitations:experimentLimitations(run.plan)};
  if(run.mode!=='live') return {...base,status:'simulation-only',qualityConclusion:null,notice:'模拟数据只验证工具链，不产生质量分数、胜率或优势结论。'};
  const missing=[],byId=new Map(),expected=packet.records.filter(r=>r.status==='accepted');
  if(!review.reviewer?.trim()||!review.reviewedAt||!Number.isFinite(Date.parse(review.reviewedAt))) missing.push('reviewer / reviewedAt');
  for(const record of review.records||[]) {
    if(byId.has(record.id)||!expected.some(e=>e.id===record.id)) throw new Error('Unknown or duplicate review record');
    byId.set(record.id,record);
  }
  const findings=[];
  function evidence(text,quote,reason,label) {
    if(typeof quote!=='string'||quote.trim().length<6||!text.includes(quote.trim())||typeof reason!=='string'||reason.trim().length<8) missing.push(label);
  }
  for(const item of expected) {
    const record=byId.get(item.id);
    if(!record) {missing.push(item.id);continue;}
    if(!['clear','issues'].includes(record.criticalReview)||!Array.isArray(record.criticalErrors)||(record.criticalReview==='issues'&&!record.criticalErrors.length)||(record.criticalReview==='clear'&&record.criticalErrors.length)) missing.push(`${item.id}: critical review`);
    for(const error of record.criticalErrors||[]) evidence(item.text,error.quote,error.reason,`${item.id}: critical evidence`);
    for(const dimension of rubric) {
      const rating=record.ratings?.[dimension.id];
      if(!Number.isInteger(rating?.score)||rating.score<0||rating.score>4) missing.push(`${item.id}: ${dimension.id} score`);
      evidence(item.text,rating?.quote,rating?.reason,`${item.id}: ${dimension.id} evidence`);
    }
    findings.push({id:mapping[item.id],arm:run.candidates.find(c=>c.id===mapping[item.id]).arm,critical:record.criticalReview==='issues',ratings:record.ratings});
  }
  const pairTemplate=createReview(run).review.profilePairs,pairIds=new Set();
  for(const pair of review.profilePairs||[]) {
    const expectedPair=pairTemplate.find(p=>p.id===pair.id);
    if(!expectedPair||pairIds.has(pair.id)||JSON.stringify(pair.recordIds)!==JSON.stringify(expectedPair.recordIds)) throw new Error('Unknown or duplicate profile pair');
    pairIds.add(pair.id);
    if(['stableVoice','preservedFacts','appropriateDepth'].some(key=>typeof pair[key]!=='boolean')) missing.push(`${pair.id}: profile checks`);
    for(const id of expectedPair.recordIds) evidence(packet.records.find(r=>r.id===id).text,pair.quotes?.[id],pair.reason,`${pair.id}: paired evidence`);
  }
  for(const pair of pairTemplate) if(!pairIds.has(pair.id)) missing.push(`${pair.id}: profile pair`);
  if(missing.length) return {...base,status:'awaiting-human-review',qualityConclusion:null,missing};
  const byArm=Object.fromEntries(run.plan.selectedArms.map(arm=>{
    const values=findings.filter(f=>f.arm===arm), candidates=run.candidates.filter(c=>c.arm===arm);
    return [arm,{total:candidates.length,failed:candidates.filter(c=>c.status==='failed').length,reviewed:values.length,
      criticalErrors:values.filter(f=>f.critical).length,
      needsRevision:values.filter(f=>f.critical||rubric.some(d=>f.ratings[d.id].score<3)).length,
      // Report every dimension separately. No weighted average can cancel a
      // factual error, missing content, or failed delivery.
      dimensions:Object.fromEntries(rubric.map(d=>[d.id,values.length?values.reduce((n,f)=>n+f.ratings[d.id].score,0)/values.length:null]))}];
  }));
  const pairedDeltas=[];
  for(const testCase of run.plan.cases) for(let repeat=1;repeat<=run.plan.repeats;repeat++) for(const comparison of run.plan.comparisons||[{baseline:'direct',treatment:'harness'}]) {
    const baseline=findings.find(f=>f.id===`${testCase.id}/${repeat}/${comparison.baseline}`),treatment=findings.find(f=>f.id===`${testCase.id}/${repeat}/${comparison.treatment}`);
    if(baseline&&treatment) pairedDeltas.push({caseId:testCase.id,repeat,...comparison,criticalFailure:baseline.critical||treatment.critical,
      dimensions:Object.fromEntries(rubric.map(d=>[d.id,treatment.ratings[d.id].score-baseline.ratings[d.id].score]))});
  }
  return {...base,status:'human-reviewed',reviewer:review.reviewer,reviewedAt:review.reviewedAt,byArm,pairedDeltas,
    profilePairs:(review.profilePairs||[]).map(pair=>({...pair,arm:run.candidates.find(c=>c.id===mapping[pair.recordIds[0]]).arm})),
    qualityConclusion:null,notice:'这是描述性人工评分，不自动宣称统计显著或泛化优势；失败候选保留在总数中，跨画像失败单列。'};
}

export function reviewHTML(packet, template) {
  const json=JSON.stringify(template).replaceAll('<','\\u003c');
  const scoreOptions='<option value="">未评分</option>'+anchors.map((label,index)=>`<option value="${index}">${esc(label)}</option>`).join('');
  const recordCard = record => {
    const index=template.records.findIndex(r=>r.id===record.id);
    return `<article><h3>版本 ${record.label} · 第 ${record.repeat} 次</h3>${record.status!=='accepted'?'<p class="failed">生成未交付有效正文，保留为失败样本；不伪造内容评分。</p>':
      `<div class="note">${record.title?`<h4>${esc(record.title)}</h4>`:''}${record.blocks.map((node,i)=>`<div class="block"><small>段 ${i+1}</small>${renderNoteHTML(node)}</div>`).join('')}</div>
      <details><summary>记录评分与段落依据</summary>${rubric.map(d=>`<label>${esc(d.label)}<select data-path="records.${index}.ratings.${d.id}.score" data-kind="number">${scoreOptions}</select><input data-path="records.${index}.ratings.${d.id}.quote" placeholder="从笔记原文字段复制一段短句"><textarea data-path="records.${index}.ratings.${d.id}.reason" placeholder="说明该短句支持何种判断；遗漏请同时说明缺少的来源要点"></textarea></label>`).join('')}
      <label>重大事实／条件／覆盖错误<select data-path="records.${index}.criticalReview"><option value="">未核对</option><option value="clear">未发现</option><option value="issues">发现错误</option></select></label>
      <label>重大错误的正文短引文<input data-critical-quote="${index}"></label><label>错误说明<textarea data-critical-reason="${index}" placeholder="为什么错误、正确的条件或来源是什么；可以在这里记录多个问题"></textarea></label>
      <details><summary>可复制的正文（含公式标记）</summary><pre>${esc(record.text)}</pre></details></details>`}</article>`;
  };
  const caseCard = testCase => {
    const {material} = testCase, {provenance,interaction} = material;
    return `<section><h2>${esc(material.title)} · ${esc(testCase.profileId)}</h2>
      <p><strong>目标：</strong>${esc(material.goal)}</p><p><strong>画像：</strong>${esc(testCase.profile.background)} ${esc(testCase.profile.foundations.join('、'))}</p>
      <p><strong>组织要求：</strong>${esc(testCase.organization)}</p>
      ${interaction?`<aside class="banner"><strong>预先固定的已有笔记 · 两组共同输入</strong><div class="note">${noteBlocks(interaction.context).map(node=>renderNoteHTML(node)).join('')}</div>
        <p><strong>选区：</strong>${esc(interaction.selection)}</p><p><strong>用户追问：</strong>${esc(interaction.instruction)}</p><small>只评新增小纸条；已有笔记不作为本次生成质量计分。</small></aside>`:''}
      <details><summary>核对来源与验收要点</summary><p>${esc(provenance.attribution)} · ${esc(provenance.license)}</p><p>${esc(provenance.priorUse)}</p>
      ${provenance.adaptation?`<p>${esc(provenance.adaptation)}</p>`:''}
      ${provenance.url?`<p>来源：${esc(provenance.url)}${provenance.licenseUrl?`；许可：${esc(provenance.licenseUrl)}`:''}</p>`:''}
      ${material.pages.map(page=>`<h3>来源页 ${page.number}</h3><pre>${esc(page.text)}</pre>`).join('')}<ul>${material.criteria.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></details>
      <div class="columns">${packet.records.filter(r=>r.caseId===testCase.id).map(recordCard).join('')}</div></section>`;
  };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>旁烛笔记 · 对照审阅</title><style>
  :root{color-scheme:light;--paper:#fbfaf6;--ink:#27382d;--line:#dce3d8;--muted:#687466}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.8 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1440px;margin:auto;padding:40px}header{max-width:850px;margin-bottom:36px}h1{font:32px Georgia,serif}h2{font-size:23px}h3{font-size:17px}small,.muted{color:var(--muted)}.banner{padding:15px 20px;background:#e8eddf;border-radius:8px}details{border-top:1px solid var(--line);padding:16px 0}summary{cursor:pointer;font-weight:600}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{min-width:0;background:#fffefb;border:1px solid var(--line);border-radius:12px;padding:24px}.note{font-family:Georgia,"Noto Serif SC",SimSun,serif;font-size:17px;line-height:1.95}.block small{font:11px system-ui}.note p{margin:6px 0 20px}.math-display{display:block;overflow:auto;text-align:center;margin:18px 0}.math-inline{display:inline-block}.math-node svg{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.8 ui-monospace,monospace}label{display:block;margin:12px 0}input,textarea,select,button{font:inherit;border:1px solid var(--line);border-radius:5px;padding:8px 12px;background:white;color:var(--ink)}input,textarea,select{display:block;width:100%;margin-top:6px}textarea{min-height:70px}button{background:#365c42;color:white;cursor:pointer}footer{position:sticky;bottom:0;padding:14px 0;background:var(--paper);border-top:1px solid var(--line)}.failed{color:#993e32}@media(max-width:700px){main{padding:20px}.columns{grid-template-columns:1fr}article{padding:18px}}
  ${reviewPrintCSS}
  </style></head><body><main><header><small>旁烛笔记 · 身份隐藏的对照审阅</small><h1>先读笔记，再看方法。</h1><p class="banner">${packet.mode==='simulation'?'离线模拟：所有正文都是工具链探针，不代表模型能力，不产生质量结论。':'真实模型输出：只隐藏方法标签，不保证无法从文风推断方法。请先完成评分，再查看私有执行记录。'}</p><p>原文、目标和稳定画像相同。每项评分须有正文短引文和理由。条件、公式或重大内容错误单独登记，不能用其他分数抵消。<span class="screen-only">刷新页面会丢失未导出的表单，请下载保存。</span></p><p class="print-only muted">离线阅读副本：保留 A／B 正文、任务背景、来源与验收要点。评分表单请回到网页填写，并另存审阅 JSON。</p><label>审阅人<input id="reviewer"></label><details><summary>评分维度与尺度</summary>${rubric.map(d=>`<p><strong>${esc(d.label)}</strong>：${esc(d.description)}</p>`).join('')}<p>${anchors.map(esc).join('；')}</p></details></header>
  <details><summary>本轮范围与局限</summary><ul>${(packet.limitations||[]).map(value=>`<li>${esc(value)}</li>`).join('')}</ul></details>
  ${packet.cases.map(caseCard).join('')}
  ${template.profilePairs.length?'<h2>跨画像一致性</h2><p>同一材料的 A／B 标签在两种画像间保持一致。检查铺垫有无合理变化，同时核对文风与核心事实是否稳定。</p>':''}
  ${template.profilePairs.map((pair,index)=>`<details><summary>${esc(pair.id)}</summary>${[['stableVoice','文风保持一致'],['preservedFacts','核心事实和条件保持一致'],['appropriateDepth','仅按需要调整铺垫']].map(([key,label])=>`<label>${label}<select data-path="profilePairs.${index}.${key}" data-kind="boolean"><option value="">未核对</option><option value="true">是</option><option value="false">否</option></select></label>`).join('')}${pair.recordIds.map(id=>`<label>${esc(id)} 的正文短引文<input data-pair="${index}" data-record="${esc(id)}"></label>`).join('')}<label>比较依据<textarea data-path="profilePairs.${index}.reason"></textarea></label></details>`).join('')}
  <footer><button id="print">打印 / 保存 PDF</button> <button id="download">下载审阅 JSON</button> <span class="muted">PDF 为阅读副本；评分请另存 JSON。没有服务器提交或模型调用。</span></footer></main><script>
  const preparePrint=${prepareReviewPrint.toString()};
  let restorePrint;
  addEventListener('beforeprint',()=>{ if(!restorePrint) restorePrint=preparePrint(); });
  addEventListener('afterprint',()=>{ restorePrint?.(); restorePrint=undefined; });
  document.getElementById('print').addEventListener('click',()=>window.print());
  const review=${json};
  document.getElementById('download').addEventListener('click',()=>{
    review.reviewer=document.getElementById('reviewer').value.trim();review.reviewedAt=new Date().toISOString();
    document.querySelectorAll('[data-path]').forEach(el=>{const path=el.dataset.path.split('.');let target=review;path.slice(0,-1).forEach(key=>target=target[key]);target[path.at(-1)]=el.value===''?(el.tagName==='SELECT'?null:''):el.dataset.kind==='number'?Number(el.value):el.dataset.kind==='boolean'?el.value==='true':el.value;});
    document.querySelectorAll('[data-pair]').forEach(el=>{review.profilePairs[Number(el.dataset.pair)].quotes[el.dataset.record]=el.value;});
    review.records.forEach((record,index)=>{record.criticalErrors=record.criticalReview==='issues'?[{quote:document.querySelector('[data-critical-quote="'+index+'"]').value,reason:document.querySelector('[data-critical-reason="'+index+'"]').value}]:[];});
    const url=URL.createObjectURL(new Blob([JSON.stringify(review,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });</script></body></html>`;
}
