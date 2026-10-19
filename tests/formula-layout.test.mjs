import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormulaText, repairFormulaDocument } from '../shared/formula-layout.mjs';
import { createDemo } from '../src/demo.ts';
import { paragraph } from '../shared/document.mjs';
import { restoreBackup } from '../shared/backup.mjs';
import { validateResult } from '../server/harness.mjs';

test('PDF glyph-level formula line breaks become readable lines without inventing operators or scripts', () => {
  const broken = '证明：\nT\nX\nt=1\ns\ng2\nt,i\nt\n≤ 2G∞∥g1:T,i∥2\n下一步说明。';
  const fixed = normalizeFormulaText(broken);
  assert.equal(fixed, '证明：\nT X t=1 s g2 t,i t\n≤ 2G∞∥g1:T,i∥2\n下一步说明。');
  assert.equal(fixed.replace(/\s/g, ''), broken.replace(/\s/g, ''), 'Only whitespace may change');
  assert.equal(normalizeFormulaText(fixed), fixed);
  assert.equal(normalizeFormulaText('β2\n1\n√β2。对于满足条件的参数。'), 'β2 1 √β2。对于满足条件的参数。');
  assert.equal(normalizeFormulaText('q\ng2\n1,i ≤ 2G∞∥g1,i∥2。'), 'q g2 1,i ≤ 2G∞∥g1,i∥2。');
});

test('prose, lists, complete equations, code, and intentional matrix/aligned layouts are unchanged', () => {
  for (const text of ['第一行\n第二行\n第三行', '1\n2\n3', 'A\nB\nC', '- a\n- b\n- c', '1. x_i\n2. y_i\n3. z_i', 'x=1\ny=2\nz=3', 'a+b\nc+d\ne+f', 'Introduction\nMethods\nResults', '```\nx\n=\na\n+\nb\n```', '\\begin{matrix}\na\n&\nb\\\\\nc\n&\nd\n\\end{matrix}']) assert.equal(normalizeFormulaText(text), text);
});

test('saved-note repair preserves source evidence, IDs, formatting, prior versions and explicit undo', () => {
  const doc = createDemo(), original = structuredClone(doc);
  const text = '公式：\nx\n=\na\n+\nb';
  doc.chapters[0].content.content.push(paragraph(text, { sourcePages: [1], sourceQuote: 'x\n=\na\n+\nb' }));
  const before = structuredClone(doc);
  const repaired = repairFormulaDocument(doc, 456);
  assert.equal(repaired.revision, doc.revision + 1);
  assert.deepEqual(doc, before);
  assert.deepEqual(repaired.pages, doc.pages);
  assert.deepEqual(repaired.chapters[0].content.content.at(-1).attrs, doc.chapters[0].content.content.at(-1).attrs);
  assert.deepEqual(repaired.versions[0].chapters, doc.chapters);
  assert.equal(repaired.versions[0].label, '修复公式换行之前');
  assert.equal(repaired.chapters[0].content.content.at(-1).content[0].text, '公式：\nx = a + b');
  assert.equal(repairFormulaDocument(repaired), repaired);
  const undone = { ...repaired, chapters: repaired.versions[0].chapters };
  assert.equal(repairFormulaDocument(undone), undone);
  assert.equal(restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: repaired })).formulaLayoutVersion, 1);
  assert.equal(repairFormulaDocument(original), original);
});

test('model output is normalized without changing source quotes or source-page validation', () => {
  const doc = createDemo(), chapter = doc.chapters[0];
  const quote = doc.pages[0].text.slice(0, 40);
  const result = validateResult({ action: 'generate', scope: 'chapter', instruction: '翻译', revision: doc.revision, chapterId: chapter.id, document: doc }, { blocks: [{ type: 'paragraph', text: 'x\n=\na\n+\nb', sourcePages: [1], sourceQuote: quote }], summary: '' });
  assert.equal(result.blocks[0].text, 'x = a + b');
  assert.equal(result.blocks[0].sourceQuote, quote);
});
