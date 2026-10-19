import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDemo } from '../src/demo.ts';
import { noteInline, noteBlocks, upgradeNoteFormat, NOTE_FORMAT } from '../shared/note-format.mjs';
import { parseMath } from '../shared/math-syntax.mjs';
import { renderMath } from '../shared/math.mjs';
import { renderNoteHTML, mathHTML } from '../shared/note-html.mjs';
import { buildMessages, validateResult, runModel } from '../server/harness.mjs';
import { applyResult, textOf, markdown } from '../shared/document.mjs';
import { printHTML } from '../server/print-document.mjs';
import { ensureNotebooks, selectNotebook, commitNotebook, restoreNotebookVersion } from '../shared/notebooks.mjs';
import { restoreBackup } from '../shared/backup.mjs';

const formula = String.raw`\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}`;
const walk = node => [node, ...(node.content || []).flatMap(walk)];
const math = nodes => nodes.flatMap(walk).filter(node => node.type === 'math');
function request(action) {
  const document = createDemo(), chapter = document.chapters[0];
  return { action, scope: 'chapter', revision: document.revision, chapterId: chapter.id, anchorId: chapter.content.content[0].attrs.id, selection: '当前选区', instruction: '解释这一处', document };
}

test('one compiler accepts Markdown math variants and paired extra delimiter escapes without touching aligned row breaks', () => {
  const variants = [`\\(${formula}\\)`, `$${formula}$`, `\\\\(${formula}\\\\)`];
  for (const source of variants) {
    const nodes = noteInline(`**关键公式**：${source}，接着解释。`, [], { strict: true });
    assert.deepEqual(math(nodes), [{ type: 'math', attrs: { latex: formula, display: false } }]);
    assert.ok(nodes[0].marks.some(mark => mark.type === 'bold'));
  }
  const aligned = String.raw`\begin{aligned}a&=b+c\\d&=e\end{aligned}`;
  for (const source of [`\\[${aligned}\\]`, `$$${aligned}$$`, `\\\\[${aligned}\\\\]`, '```latex\n'+aligned+'\n```']) {
    const blocks = noteBlocks(source, {}, { strict: true });
    assert.equal(math(blocks).length, 1);
    assert.equal(math(blocks)[0].attrs.latex, aligned);
    assert.equal(math(blocks)[0].attrs.display, true);
    assert.match(renderMath(aligned, true).svg, /mtable/);
  }
});

test('literal code, prices and escaped dollars survive while unclosed explicit math is rejected', () => {
  const literal = '`\\(example\\)` and $20 and $30 and \\$50';
  const nodes = noteInline(literal, [], { strict: true });
  assert.equal(math(nodes).length, 0);
  assert.ok(nodes.some(n => n.marks?.some(m => m.type === 'code') && n.text === '\\(example\\)'));
  assert.equal(math(noteBlocks('```js\nconst s = "\\(x\\)";\n```', {}, { strict: true })).length, 0);
  for (const source of [String.raw`\(x+1`, String.raw`\[x\)`, '$$x+1', '$x', String.raw`\\(x\)`, String.raw`\frac{x}{y}`]) assert.throws(() => noteInline(source, [], { strict: true }), /定界符/);
  assert.equal(parseMath('价格 $20 和 $30').filter(n => n.type === 'math').length, 0);
  assert.throws(() => noteInline('\frac{x}{y}'.replace('\\f', '\f'), [], { strict: true }), /控制字符/);
});

test('source quotations render balanced MediaWiki TeX through the same math renderer without changing evidence', () => {
  const quote = String.raw`{\textstyle \gamma ^{j}\sum _{n=1}^{\infty }{\frac {\lambda ^{n-1}}{1-\lambda }}\cdot \left(\sum _{k=0}^{n-1}\gamma ^{k}R_{j+k}+\gamma ^{n}V^{\pi _{\theta }}(S_{j+n})-V^{\pi _{\theta }}(S_{j})\right)}` + '\n \n: TD(λ) learning, also known as GAE (generalized advantage estimate).[4]';
  const before=quote, blocks=noteBlocks(quote,{}, {source:true});
  assert.equal(math(blocks).length,1);assert.equal(math(blocks)[0].attrs.latex,quote.split('\n')[0]);assert.equal(math(blocks)[0].attrs.display,true);assert.equal(quote,before);
  const dom=new JSDOM(renderNoteHTML({type:'doc',content:blocks}));
  assert.equal(dom.window.document.querySelectorAll('.math-display svg').length,1);assert.equal(dom.window.document.querySelector('.math-invalid'),null);
  assert.match(dom.window.document.body.textContent,/TD\(λ\) learning/);assert.doesNotMatch(dom.window.document.body.textContent,/\\textstyle|\\frac/);dom.window.close();
  const inline=String.raw`A set {\displaystyle \{x_{i}\}} appears inline.`;
  assert.equal(math(noteBlocks(inline,{}, {source:true}))[0].attrs.display,false);
  assert.equal(math(noteBlocks(quote)).length,0,'compatibility is opt-in for source quotations');
  for(const literal of ['`'+quote.split('\n')[0]+'`','```text\n'+quote+'\n```',String.raw`{\textstyle \frac{x}{y}`,String.raw`plain {x_i} and {\frac{x}{y}}`]) assert.equal(math(noteBlocks(literal,{}, {source:true})).length,0);
  assert.throws(()=>noteBlocks(quote,{}, {strict:true}),/定界符/,'source compatibility does not loosen the model contract');
});

test('all harness actions return the same trusted node format and applying paper notes keeps its rendering unchanged', async () => {
  const source = `**重点**：\\\\(${formula}\\\\)，保持解释连贯。`;
  const outputs = {};
  for (const action of ['generate', 'explain', 'rewrite', 'style']) {
    const input = request(action);
    const raw = { summary: '格式统一', ...(action === 'generate' ? { blocks: [{ type: 'paragraph', text: source }] }
      : action === 'explain' ? { title: '理解更新幅度', paragraphs: [source], sourcePages: [1] }
        : action === 'rewrite' ? { text: source } : { edits: [{ id: input.anchorId, text: source }] }), rendering: { format: NOTE_FORMAT, inline: [{ type: 'text', text: 'untrusted' }] } };
    const result = validateResult(input, raw);
    assert.equal(result.rendering.format, NOTE_FORMAT);
    const nodes = result.rendering.blocks || result.rendering.inline || result.rendering.edits.flatMap(edit => edit.content);
    assert.deepEqual(math(nodes), [{ type: 'math', attrs: { latex: formula, display: false } }]);
    assert.doesNotMatch(JSON.stringify(result.rendering), /untrusted/);
    assert.match(buildMessages(input)[0].content, /reading-tree-note-v1/);
    outputs[action] = { input, result };
  }
  const { input, result } = outputs.explain;
  const updated = applyResult(input.document, input, result);
  const note = updated.chapters[0].content.content[1];
  const preview = renderNoteHTML({ type: 'doc', content: result.rendering.blocks });
  const dom = new JSDOM(await printHTML(updated));
  assert.equal(dom.window.document.querySelector('.paper-note-body').innerHTML, new JSDOM(preview).window.document.body.innerHTML);
  assert.equal(dom.window.document.querySelector('.paper-note-body .math-node').innerHTML, mathHTML(note.content[0].content.find(n => n.type === 'math').attrs));
  assert.ok(markdown(updated).includes(`\\(${formula}\\)`));
  assert.equal(textOf(note).includes('\\\\('), false);
});

test('invalid formula notation uses the existing bounded repair without committing broken output', async () => {
  const input = request('explain'); let calls = 0;
  const invalid = { title: '解释', paragraphs: [String.raw`定义 \(x^2`], sourcePages: [1], summary: '补充' };
  const fixed = { ...invalid, paragraphs: [String.raw`定义 \(x^2\)`] };
  const fetcher = async (_url, init) => {
    calls++;
    if (calls === 2) assert.match(JSON.parse(init.body).messages.at(-1).content, /定界符/);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(calls === 1 ? invalid : fixed) } }] }));
  };
  const raw = await runModel({ baseUrl: 'http://localhost', model: 'mock', apiKey: 'mock' }, buildMessages(input), undefined, fetcher);
  assert.equal(calls, 2);
  assert.equal(math(validateResult(input, raw).rendering.blocks).length, 1);
});

test('stored note compatibility preserves IDs, source, code, other editions and undo across backup', () => {
  let document = ensureNotebooks(createDemo());
  document = selectNotebook(document, 'adaptive');
  const content = document.chapters[0].content;
  content.content = [{ type: 'explanation', attrs: { id: 'personal-note', title: '保留我的纸条', origin: 'user', sourcePages: [1] }, content: [
    { type: 'paragraph', attrs: { id: 'paragraph', sourceQuote: String.raw`\\(original\\)` }, content: [{ type: 'text', text: `**重点** \\\\(${formula}\\\\)` }] },
    { type: 'paragraph', content: [{ type: 'text', text: String.raw`\(literal\)`, marks: [{ type: 'code' }] }] },
  ] }];
  const before = structuredClone(document);
  const updated = commitNotebook(upgradeNoteFormat(document, 123));
  assert.equal(updated.chapters[0].content.content[0].attrs.id, 'personal-note');
  assert.equal(updated.chapters[0].content.content[0].content[0].attrs.sourceQuote, before.chapters[0].content.content[0].content[0].attrs.sourceQuote);
  assert.deepEqual(updated.chapters[0].content.content[0].content[1], before.chapters[0].content.content[0].content[1]);
  assert.equal(math(updated.chapters[0].content.content).length, 1);
  assert.deepEqual(updated.pages, before.pages);
  assert.deepEqual(updated.notebooks.translation, before.notebooks.translation);
  assert.deepEqual(updated.versions[0].chapters, before.chapters);
  assert.equal(upgradeNoteFormat(updated), updated);
  const restored = restoreBackup(JSON.stringify({ format: 'reading-tree-v1', document: updated }));
  assert.equal(restored.noteFormatVersion, 1);
  const undone = restoreNotebookVersion(restored, restored.versions[0].chapters);
  assert.equal(upgradeNoteFormat(undone), undone);
  assert.deepEqual(document, before);
});
