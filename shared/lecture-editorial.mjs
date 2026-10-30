import { isLectureSynthesis } from './lecture-synthesis.mjs';

const prose = block => block.text || block.items?.join('\n') || (block.content || []).map(prose).join(' ');
const normalize = value => value.replace(/\s+/gu,'');
// Approximate reading volume, not billing tokens or a validity boundary.
export const lectureLength = value => value.replace(/\\[a-zA-Z]+/g,'').replace(/[\s{}$\\]/g,'').length;
export function lectureEditorial(request, candidate) {
  if (!isLectureSynthesis(request)) return undefined;
  const blocks=candidate?.blocks || [], duplicates=[];
  const seen=new Map();
  const chapterIndex=request.document.chapters.findIndex(c=>c.id===request.chapterId);
  // Only exact substantial paragraphs are suspicious. A shared symbol or
  // short definition alone never authorizes deleting text.
  for (const chapter of request.document.chapters.slice(0,Math.max(0,chapterIndex))) for (const block of chapter.content.content || []) {
    if (!['paragraph','bulletList'].includes(block.type)) continue;
    const text=prose(block),key=normalize(text);if(key.length>=90)seen.set(key,{chapter:chapter.title,quote:text.slice(0,500)});
  }
  blocks.forEach((block,index)=>{
    if(block.type==='heading')return;
    const text=prose(block),key=normalize(text);if(key.length<90)return;
    if(seen.has(key)&&duplicates.length<6)duplicates.push({index,matches:seen.get(key),quote:text.slice(0,500)});
    else seen.set(key,{index,quote:text.slice(0,500)});
  });
  const length=blocks.length?lectureLength(blocks.map(prose).join('\n')):undefined;
  return {version:'lecture-editorial-v2',...(length!==undefined?{actualLength:length}:{}),duplicates,
    rule:'篇幅只记录，不因长度或按知识点估算的字数触发审查。重复线索来自实际段落，须结合本次教学职责、新应用和关键推理核实，不能自动删文；同例递进应用、必要证明与适量回顾可以保留。检查读者能否完成本章任务，删除没有新增教学作用的重复铺垫。'};
}
