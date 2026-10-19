import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMath, mathText, renderMath, mathifyNode } from '../shared/math.mjs';
import { upgradeMathDocument } from '../shared/math-references.mjs';
import references from '../shared/adam-math.json' with { type: 'json' };
import { createDemo } from '../src/demo.ts';
import { paragraph, textOf, markdown, applyResult } from '../shared/document.mjs';
import { restoreBackup } from '../shared/backup.mjs';
import { buildMessages, validateResult } from '../server/harness.mjs';

test('math retains fractions, scripts and summation structure as standalone vector output', () => {
  for (const ref of references.formulas) {
    const result = renderMath(ref.latex, ref.display);
    assert.ok(result.width > 0 && result.height > 0);
    assert.doesNotMatch(result.svg, /merror|NaN|<image|href=/);
  }
  const { svg } = renderMath(String.raw`\frac{\beta_1^2}{\sqrt{\beta_2}}`, false);
  assert.match(svg, /data-mml-node="mfrac"/);
  assert.match(svg, /data-mml-node="msubsup"/);
  assert.match(svg, /data-mml-node="msqrt"/);
  assert.throws(()=>renderMath(String.raw`\frac{x}{`));
  assert.throws(()=>renderMath(String.raw`\href{javascript:alert(1)}{x}`));
  assert.throws(()=>renderMath(String.raw`\require{html}`));
});

test('explicit math delimiters round trip through rich notes and backups without parsing currency or code', () => {
  const text = String.raw`条件 \(x_i^2\le 1\)，公式：\[\frac{a}{b}\]`;
  const p = paragraph(text), doc = createDemo();
  assert.equal(p.content.filter(n=>n.type==='math').length, 2);
  assert.equal(textOf(p), text);
  assert.equal(parseMath('价格 $20 和 $30').filter(n=>n.type==='math').length,0);
  assert.equal(mathifyNode({type:'paragraph',content:[{type:'text',text,marks:[{type:'code'}]}]}).content[0].type,'text');
  doc.chapters[0].content.content.push(p);
  const backup = restoreBackup(JSON.stringify({format:'reading-tree-v1',document:doc}));
  assert.deepEqual(backup.chapters[0].content.content.at(-1),p);
  assert.ok(markdown(doc).includes(text));
  const changed = applyResult(doc,{action:'style',revision:doc.revision,chapterId:doc.chapters[0].id,scope:'chapter'},{edits:[{id:p.attrs.id,text:String.raw`新公式 \(\alpha_t=\frac\alpha{\sqrt t}\)`}]});
  assert.equal(changed.chapters[0].content.content.at(-1).content[1].type,'math');
});

test('source-backed repair recognizes the reported Adam fragments and preserves surrounding prose, evidence, IDs, history and undo', () => {
  const doc = createDemo(); doc.title = 'Adam: A Method for Stochastic Optimization';
  doc.pages = Array.from({length:9},(_,i)=>({number:i+1,text: i===3 ? 'Our Theorem 4.1 Zinkevich\n' : ''}));
  for (const ref of references.formulas) doc.pages[ref.page-1].text += ref.extracted+'\n';
  const theorem = references.formulas.find(r=>r.latex.startsWith('\\begin{aligned}R(T)'));
  const old = {type:'paragraph',attrs:{id:'theorem',sourcePages:[4],sourceQuote:theorem.extracted},content:[{type:'text',text:'定理如下：'+theorem.extracted.replace(/\s+/g,' ')+'。这是我的补充。'}]};
  doc.chapters[0].content.content = [old,...references.formulas.filter(r=>r.page===9&&r.display).map(r=>({type:'paragraph',attrs:{id:crypto.randomUUID()},content:[{type:'text',text:r.extracted}]}))];
  const before = structuredClone(doc);
  const fixed = upgradeMathDocument(doc,123);
  assert.equal(fixed.mathTypesetVersion,1);
  assert.equal(fixed.revision,doc.revision+1);
  assert.deepEqual(fixed.pages,doc.pages);
  assert.deepEqual(fixed.chapters[0].content.content[0].attrs,old.attrs);
  assert.equal(fixed.chapters[0].content.content[0].content[0].text,'定理如下：');
  assert.equal(fixed.chapters[0].content.content[0].content.at(-1).text,'。这是我的补充。');
  assert.equal(fixed.chapters[0].content.content[0].content[1].type,'math');
  assert.ok(fixed.chapters[0].content.content.every(p=>p.content.some(n=>n.type==='math')));
  assert.deepEqual(fixed.versions[0].chapters,doc.chapters);
  assert.deepEqual(doc,before);
  assert.equal(upgradeMathDocument(fixed),fixed);
  const undone = {...fixed,chapters:fixed.versions[0].chapters};
  assert.equal(upgradeMathDocument(undone),undone);
  const foreign = {...doc,title:'Another paper'};
  assert.equal(upgradeMathDocument(foreign),foreign);
});

test('model harness requests real LaTeX and rejects incomplete or active math commands before applying edits', () => {
  const doc = createDemo(), chapter=doc.chapters[0];
  const request={action:'generate',scope:'chapter',instruction:'翻译',revision:doc.revision,chapterId:chapter.id,document:doc};
  const messages=buildMessages(request);
  assert.match(messages[0].content,/LaTeX/);
  assert.match(messages[0].content,/formulaReferences/);
  const result=validateResult(request,{blocks:[{type:'paragraph',text:String.raw`定义 \[x=\frac{a}{b}\]`} ]});
  assert.equal(parseMath(result.blocks[0].text)[1].type,'math');
  assert.throws(()=>validateResult(request,{blocks:[{type:'paragraph',text:String.raw`\[\frac{a}{\]`}]}),e=>e.code==='INVALID_EDIT_FORMAT');
});
