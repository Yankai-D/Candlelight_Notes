import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deferredMaterial,hydrateMaterial,placeImportedMaterial} from '../shared/material-ingestion.mjs';
import {reconcileCollection} from '../shared/collection.mjs';
import {captureBundleContext,createBundleNote,bundleMaterials} from '../shared/bundle-context.mjs';
import {storedDocumentSchema} from '../shared/backup.mjs';

test('thirty originals import without reading text or generating notes and retain two nested bundle levels',async()=>{
 const documents=[];let collection={version:1,folders:[],items:{}};
 for(let i=0;i<30;i++){
  const doc=deferredMaterial({name:`unit-${i}.pdf`,size:100},'期末复习');documents.push(doc);
  assert.equal(storedDocumentSchema.parse(doc).sourceState,'deferred');assert.equal(doc.readingPolicy,'manual');assert.equal(doc.pages[0].text,'');assert.equal(doc.chapters[0].status,'empty');
  collection=reconcileCollection(collection,documents,{materials:[]});collection=placeImportedMaterial(collection,doc.id,`期末复习/数学/单元${i%3}/unit-${i}.pdf`);
 }
 const root=collection.folders.find(f=>f.name==='期末复习');assert.equal(collection.folders.length,5);assert.equal(bundleMaterials(documents,collection,root.id).length,30);assert.ok(collection.folders.every(f=>f.kind==='bundle'&&!f.inTree));
 let reads=0,parses=0,saves=0;const hydrated=[];
 for(const doc of documents)hydrated.push(await hydrateMaterial(doc,{read:async()=>{reads++;return 'file'},parse:async()=>{parses++;return {pages:[{number:1,text:`原文 ${doc.title}`}],chapters:[{...doc.chapters[0],title:doc.title}]}},save:async()=>{saves++}}));
 const context=captureBundleContext(hydrated,collection,root.id);
 const lecture=createBundleNote(context,'数学讲义','整理全部知识'),exercises=createBundleNote(context,'例题讲解','整理例题与解法');
 assert.equal(lecture.sourceContext.sources.length,30);assert.equal(exercises.sourceContext.sources.length,30);assert.notEqual(lecture.id,exercises.id);
 for(const doc of hydrated)await hydrateMaterial(doc,{read:()=>{throw Error('must reuse cache')},parse:()=>{throw Error('no parse')},save:()=>{throw Error('no write')}});
 assert.equal(reads,30);assert.equal(parses,30);assert.equal(saves,30);assert.ok(hydrated.every(doc=>doc.chapters.every(c=>c.status==='empty')));
});
test('deferred source failures do not invent content or overwrite records; invalid hierarchy is rejected',async()=>{
 const doc=deferredMaterial({name:'a.pdf',size:100});let saves=0;
 await assert.rejects(hydrateMaterial(doc,{read:async()=>undefined,parse:async()=>{},save:async()=>{saves++}}),/原始文件/);
 await assert.rejects(hydrateMaterial(doc,{read:async()=>true,parse:async()=>{throw Error('corrupt PDF')},save:async()=>{saves++}}),/corrupt/);
 assert.equal(saves,0);assert.equal(doc.sourceState,'deferred');
 const collection=reconcileCollection({version:1,folders:[],items:{}},[doc],{materials:[]});
 assert.throws(()=>placeImportedMaterial(collection,doc.id,'../../a.pdf'),/路径/);
 assert.throws(()=>placeImportedMaterial(collection,doc.id,'a.pdf','missing'),/不存在/);
});
