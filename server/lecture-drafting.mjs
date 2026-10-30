import { sourceEvidenceIndex } from './source-evidence-index.mjs';

// A source chunk is a reading boundary, never a required piece of output.
// Keep whole pages so content-bound evidence IDs survive analysis/consolidation.
export function lectureAnalysisGroups(pages, limit = 48000) {
  const groups = []; let group = [], size = 0;
  for (const page of pages) {
    if (group.length && size + page.text.length > limit) { groups.push(group); group=[]; size=0; }
    group.push(page); size += page.text.length;
  }
  if (group.length) groups.push(group);
  return groups;
}
const references = unit => [...new Set([...unit.sourceEvidenceIds,
  ...unit.examples.flatMap(e=>e.sourceEvidenceIds), ...unit.variants.flatMap(e=>e.sourceEvidenceIds)])];

// One planned chapter -> one writing task. Source length controls reading
// batches only, never the number of prose fragments subsequently concatenated.
// Keep originals for validation; send selected verbatim evidence, not a summary
// and not the rest of every page that happens to contain a selected passage.
export function lectureDrafts(pages, analysis) {
  const evidence=sourceEvidenceIndex(pages),selected=analysis.synthesis.units,refs=new Set(selected.flatMap(references));
  const pageIds=new Set();
  for(const id of refs){const span=evidence.byId.get(id);if(!span)throw new Error('讲义选材不属于当前原文。');pageIds.add(span.page);}
  const source=pages.filter(page=>pageIds.has(page.number));
  const packet=source.map(page=>{
    const spans=evidence.source.find(p=>p.number===page.number).excerpts.filter(e=>refs.has(e.id));
    const text=spans.map(e=>e.text).join('\n\n');
    return {...page,text,selectedEvidenceIds:spans.map(e=>e.id),partial:text!==page.text};
  });
  return [{pages:source,evidencePacket:packet,chapterAnalysis:{...analysis,
    steps:analysis.steps.filter(s=>!s.sourceEvidenceIds.length||s.sourceEvidenceIds.some(id=>refs.has(id))),
    risks:analysis.risks.filter(s=>!s.sourceEvidenceIds.length||s.sourceEvidenceIds.some(id=>refs.has(id))),
    // Selection decisions remain in the analysis checkpoint. Writers receive
    // only the deliverable, not a checklist of everything read and excluded.
    synthesis:{...analysis.synthesis,units:selected,merges:[],omissions:[]},
    draftingScope:{mode:'knowledge-units',basis:'learning-outcomes-v1',topics:selected.map(u=>u.topic),elsewhere:[],
      finishWhen:selected.map(u=>({id:u.id,understand:u.concept,perform:u.method,examples:u.examples.map(e=>e.aim),variants:u.variants.map(v=>v.difference)})),
      rule:'篇幅与 source 字数、页数、文件数、阅读批次数无关。完成 finishWhen 的知识、操作与代表例题即结束；source 是取证材料，不是逐段扩写清单。同型证据不重复讲解，不为每项用途机械拆段，不在结尾复述全章。'} }}];
}

// Evidence expansion changes available input, never the writing plan or its
// scope. Exact original page IDs and text stay intact throughout the workflow.
export function expandLectureEvidence(packet,originals,ids) {
  const fresh=new Set(ids);
  if(!fresh.size||fresh.size!==ids.length||ids.some(id=>!packet.some(p=>p.number===id&&p.partial)))
    throw Object.assign(new Error('只能请求尚未完整提供的当前选材页。'),{code:'STAGE_CONTRACT',issues:[{path:['sourcePages'],expected:packet.filter(p=>p.partial).map(p=>p.number)}]});
  return packet.map(page=>fresh.has(page.number)?{...originals.find(p=>p.number===page.number),partial:false}:page);
}
