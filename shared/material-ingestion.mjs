import { defaultLearningIntent } from './learning-intent.mjs';
import { materialFormat } from './material-formats.mjs';
import { createFolder, updateCollectionItem } from './collection.mjs';

export function deferredMaterial(file, intent = defaultLearningIntent, readingPolicy = 'manual', now = Date.now()) {
  if (!materialFormat(file.name)) throw new Error('不支持这份文件的格式，请使用 PDF、DOCX、PPTX、HTML、Markdown 或 TXT。');
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('请选择非空且不超过 50 MB 的文件。');
  const id=crypto.randomUUID(), chapterId=crypto.randomUUID();
  return {id,title:file.name.replace(/\.[^.]+$/,''),subtitle:'我的学习资料',filename:file.name,kind:/\.pdf$/i.test(file.name)?'pdf':'text',
    sourceState:'deferred',readingPolicy,intent:intent.trim() || defaultLearningIntent,intentSource:intent.trim() && intent.trim()!==defaultLearningIntent?'user':'default',
    createdAt:now,updatedAt:now,revision:0,versions:[],currentChapter:chapterId,currentPage:1,
    // An empty placeholder preserves older backup invariants; it is never
    // presented as an extracted page or passed to a generation request.
    pages:[{number:1,text:''}],chapters:[{id:chapterId,title:'待读取原文',sourcePages:[1],status:'empty',content:{type:'doc',content:[]}}]};
}
export async function hydrateMaterial(document, {read, parse, save, signal = undefined}) {
  if (document.sourceState !== 'deferred') return document;
  signal?.throwIfAborted();
  const file=await read(document);if(!file)throw new Error(`找不到「${document.title}」的原始文件，请重新关联原件。`);
  const parsed=await parse(file,document);signal?.throwIfAborted();
  if (!parsed.pages.some(page=>page.text.trim())) throw new Error(`「${document.title}」没有可读取的正文。`);
  const next={...document,pages:parsed.pages,chapters:parsed.chapters,currentChapter:parsed.chapters[0].id,currentPage:1,
    sourceWarnings:parsed.sourceWarnings,sourceState:'ready',updatedAt:Date.now(),revision:document.revision+1};
  delete next.notebooks;delete next.activeNotebookId;delete next.notebookDefaultsVersion;
  await save(next);return next;
}
/** @param {string|null} targetId */
export function placeImportedMaterial(collection, id, relativePath = '', targetId = null) {
  const parts=relativePath ? relativePath.split('/').slice(0,-1) : [];
  if(parts.length>12 || parts.some(part=>!part||part==='.'||part==='..'||/[\\:\0]/.test(part)||part.length>60))throw new Error('文件夹路径无效、层级过深或名称超过 60 字。');
  if(targetId&&!collection.folders.some(folder=>folder.id===targetId))throw new Error('导入目标文件夹已不存在。');
  let next=collection,parentId=targetId;
  for(const name of parts){
    let folder=next.folders.find(folder=>(folder.parentId||null)===(parentId||null)&&folder.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    if(!folder){const folderId=crypto.randomUUID();next=createFolder(next,name,folderId,{kind:'bundle',parentId,inTree:false});folder=next.folders.find(f=>f.id===folderId);}
    parentId=folder.id;
  }
  return updateCollectionItem(next,id,{folderId:parentId,...(parts.length?{inTree:false}:{})});
}
