import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceAt, locateReading } from '../shared/reading.mjs';
import { createDemo } from '../src/demo.ts';
import { paragraph, withIds } from '../shared/document.mjs';

test('continuous scroll follows the visible chapter, including scrolling backward', () => {
  const doc = createDemo();
  const layouts = doc.chapters.map((c, i) => ({ id: c.id, top: i * 1000, height: 1000, blocks: c.content.content.map((b, j) => ({ id: b.attrs.id, top: i * 1000 + 150 + j * 70, height: 70 })) }));
  let position = locateReading(doc.chapters, layouts, 3000, 600, 5000);
  assert.equal(position.chapterId, 'multihead');
  assert.equal(position.source.page, 5);
  assert.equal(position.source.fraction, 0);
  position = locateReading(doc.chapters, layouts, 1500, 600, 5000);
  assert.equal(position.chapterId, 'attention');
  assert.equal(position.source.page, 3);
  assert.ok(position.progress > 0 && position.progress < 1);
  position = locateReading(doc.chapters, layouts, 0, 600, 5000);
  assert.equal(position.chapterId, 'intro');
});
test('source offsets move through a page and across pages, preserving a wider original context', () => {
  const chapter = createDemo().chapters[1];
  const first = sourceAt(chapter, chapter.content.content[0].attrs.id, 0);
  const later = sourceAt(chapter, chapter.content.content[3].attrs.id, 0.8);
  const next = sourceAt(chapter, chapter.content.content[6].attrs.id, 0.2);
  assert.equal(first.page, 2); assert.equal(later.page, 2);
  assert.ok(later.fraction > first.fraction);
  assert.equal(next.page, 3);
  assert.match(first.quote, /content-based retrieval/);
});
test('adding user paper notes does not push the original source anchors', () => {
  const chapter = createDemo().chapters[1];
  const block = chapter.content.content[7];
  const original = sourceAt(chapter, block.attrs.id, 0.3);
  chapter.content.content.splice(1, 0, withIds({ type: 'explanation', attrs: { title: '个人理解', sourcePages: [] }, content: [paragraph('很多个人补充。'.repeat(300))] }));
  assert.deepEqual(sourceAt(chapter, block.attrs.id, 0.3), original);
  assert.equal(sourceAt(chapter, chapter.content.content[1].attrs.id, 0.8).page, 2);
});
test('legacy notes without page anchors fall back within their own chapter', () => {
  const chapter = { id: 'legacy', sourcePages: [10, 11, 12], content: { type: 'doc', content: [paragraph('一'.repeat(100)), paragraph('二'.repeat(100)), paragraph('三'.repeat(100))] } };
  assert.equal(sourceAt(chapter, chapter.content.content[0].attrs.id, 0).page, 10);
  assert.equal(sourceAt(chapter, chapter.content.content[2].attrs.id, 0.8).page, 12);
  assert.equal(sourceAt(chapter, chapter.content.content[1].attrs.id, 0.5).approximate, true);
});

test('a source quote stays attached throughout its paragraph instead of reverting to an estimate at 65 percent', () => {
  const block = paragraph('正文'.repeat(100), { sourcePages: [2], sourceQuote: 'an exact source quote' });
  const chapter = { sourcePages: [2], content: { type: 'doc', content: [block] } };
  for (const progress of [0, .64, .65, .9, 1]) assert.equal(sourceAt(chapter, block.attrs.id, progress).quote, 'an exact source quote');
});

test('inline notes hold at the preceding paragraph end, and citations spanning pages follow source order', () => {
  const block = paragraph('正文'.repeat(100), { sourcePages: [3, 2, 3] });
  const note = withIds({ type: 'explanation', attrs: { title: '我的理解', sourcePages: [] }, content: [paragraph('补充解释')] });
  const chapter = { sourcePages: [2, 3], content: { type: 'doc', content: [block, note] } };
  assert.equal(sourceAt(chapter, block.attrs.id, 0).page, 2);
  assert.deepEqual(sourceAt(chapter, note.attrs.id, .8), sourceAt(chapter, block.attrs.id, 1));
});
