import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { statisticsCatalog } from '../packaging/windows/catalog.mjs';
import { reconcileCollection } from '../shared/collection.mjs';
import { validateDistributionPath } from '../packaging/windows/policy.mjs';

test('distribution audit excludes application state and extra PDFs while retaining public dependency tables',()=>{
  for(const path of ['data/browser/History','app/.env','app/.cache/organization-last.json','app/.local-library/catalog.json',
    'app/artifacts/review.json','app/.local-ideal-trees/job.json','app/.local-storage/library-index.json','backups/catalog.json','app/node_modules/test/.env','materials/adam.pdf','../secret']) {
    assert.throws(()=>validateDistributionPath(path));
  }
  for(const path of ['app/node_modules/bidi-js/src/data/bidiBrackets.data.js','materials/catalog.json',
    'materials/descriptive-statistics-textbook.pdf','app/server/settings-store.mjs'])assert.doesNotThrow(()=>validateDistributionPath(path));
});

test('portable statistics catalog is rebuilt from public sources, with no user state or unrelated folders',async()=>{
  const {sources}=JSON.parse(await readFile(new URL('../examples/course/descriptive-statistics/sources.json',import.meta.url),'utf8'));
  sources[0].notebooks={private:'DO_NOT_DISTRIBUTE'};sources[0].apiKey='DO_NOT_DISTRIBUTE';
  const catalog=statisticsCatalog(sources);
  assert.equal(catalog.documents.length,3);assert.equal(JSON.stringify(catalog).includes('DO_NOT_DISTRIBUTE'),false);
  for(const doc of catalog.documents){
    assert.equal(doc.revision,0);assert.deepEqual(doc.versions,[]);assert.equal(doc.notebooks,undefined);
    assert.ok(doc.chapters.every(chapter=>chapter.status==='empty'&&chapter.content.content[0].content.length===0));
    assert.ok(doc.chapters.flatMap(chapter=>chapter.sourcePages).every(number=>number>=2&&number<=doc.pages.length));
  }
  const collection=reconcileCollection(null,catalog.documents);
  assert.deepEqual(collection.folders,[{id:'descriptive-statistics',name:'描述性统计',kind:'bundle',inTree:false}]);
  assert.ok(Object.values(collection.items).every(item=>item.folderId==='descriptive-statistics'&&!item.inTree&&item.status==='imported'));
  assert.throws(()=>statisticsCatalog([...sources,{id:'private-paper'}]),/exactly/);
  const saved={version:1,folders:[{id:'personal',name:'保留用户的文件夹'}],items:{}};
  assert.ok(reconcileCollection(saved,catalog.documents).folders.some(folder=>folder.id==='personal'));
});
