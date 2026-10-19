import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderLearningPDF, openPrintPage } from '../server/pdf-export.mjs';
import { printHTML } from '../server/print-document.mjs';
import { inlineMathDocument } from './fixtures/inline-math.mjs';
import { createDemo } from '../src/demo.ts';
import { paragraph } from '../shared/document.mjs';

// Chromium's embedded CJK font maps shared radical glyphs to compatibility
// characters. Normalize those equivalent glyphs for searchable prose checks.
const prose = text => text.replace(/[\u2F00-\u2FDF]/g, char => char.normalize('NFKC'));

test('authored sample PDF has six readable pages and matches its source text', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile('public/attention-field-notes.pdf')), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 6);
    const content = await (await pdf.getPage(2)).getTextContent();
    const text = content.items.map(item => item.str || '').join(' ');
    assert.match(text, /content-based retrieval/);
    assert.match(text, /not an empirical claim/);
    const last = await (await pdf.getPage(6)).getTextContent();
    assert.match(last.items.map(i => i.str).join(' '), /not a reproduction or translation/);
  } finally { await task.destroy(); }
});

test('structured math exports as vector fractions and scripts alongside selectable prose', async () => {
  const doc=createDemo();
  doc.chapters=[{...doc.chapters[0],content:{type:'doc',content:[paragraph(String.raw`数学条件：\(\frac{\beta_1^2}{\sqrt{\beta_2}}<1\)。保留说明。`),paragraph(String.raw`\[u_t=\max(\beta_2 u_{t-1},|g_t|)\tag{12}\]`)]}}];
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=pdfjs.getDocument({data:new Uint8Array(await renderLearningPDF(doc)),useSystemFonts:true});
  try {
    const pdf=await task.promise, page=await pdf.getPage(1);
    const text=(await page.getTextContent()).items.map(i=>i.str).join('');
    assert.match(text,/数学条件/); assert.match(text,/保留说明/);
    assert.doesNotMatch(text,/\\frac|\\beta/);
    const operators=await page.getOperatorList();
    assert.ok(!operators.fnArray.includes(pdfjs.OPS.paintImageXObject));
    assert.ok(operators.fnArray.filter(op=>op===pdfjs.OPS.constructPath).length>20,'Fractions and scripts must be present as vector paths');
  } finally { await task.destroy(); }
});

test('styled export is one tall PDF with selectable Chinese, formulas and inline paper notes', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buffer = await renderLearningPDF(createDemo());
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 1);
    const page = await pdf.getPage(1);
    assert.ok(page.view[3] > page.view[2] * 3);
    const text = prose((await page.getTextContent()).items.map(i => i.str).join('')).replace(/\s+/g, '');
    assert.match(text, /为什么需要注意力/);
    assert.match(text, /小纸条/);
    assert.match(text, /停一下，检查理解/);
    assert.match(text, /√dₖ/);
    assert.match(text, /QKᵀ/);
    assert.doesNotMatch(text, /\uFFFD/);
    const operators = await page.getOperatorList();
    assert.ok(operators.fnArray.includes(pdfjs.OPS.setFillRGBColor) || operators.fnArray.includes(pdfjs.OPS.setFillColorN));
    assert.ok(!operators.fnArray.includes(pdfjs.OPS.paintImageXObject), 'Export should keep vector text, not a screenshot');
  } finally { await task.destroy(); }
});

test('replacement characters and malformed UTF-16 export visibly without losing adjacent prose, symbols or saved notes', async () => {
  const document = createDemo();
  document.title = '标题\uFFFD保留';
  document.subtitle = '副标题\ud800仍可读';
  document.intent = '保留内容\udc00';
  document.chapters = [{ ...document.chapters[0], title: '章节\uFFFD正文', content: { type: 'doc', content: [
    paragraph('前文\uFFFD后文；孤立高位\ud800结束；孤立低位\udc00结束；数学字母\u{1D6FC}保留。'),
    { type: 'paragraph', content: [{ type: 'text', text: '强调\uFFFD文字', marks: [{ type: 'bold' }, { type: 'italic' }] }] },
    paragraph(String.raw`独立公式仍然排版：\[v_t=\beta_2v_{t-1}+(1-\beta_2)g_t^2\]`),
    { type: 'explanation', attrs: { title: '纸条\uFFFD标题', sourcePages: [1] }, content: [paragraph('纸条内容\uFFFD继续。')] },
  ] } }];
  const before = structuredClone(document);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await renderLearningPDF(document)), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const text = prose((await page.getTextContent()).items.map(item => item.str).join('')).replace(/\s+/g, '');
    for (const expected of ['标题\uFFFD保留', '副标题\uFFFD仍可读', '章节\uFFFD正文',
      '前文\uFFFD后文', '孤立高位\uFFFD结束', '孤立低位\uFFFD结束', '\u{1D6FC}保留', '强调\uFFFD文字', '纸条\uFFFD标题', '纸条内容\uFFFD继续']) {
      assert.ok(text.includes(expected), `Export must preserve ${expected}; received ${text}`);
    }
    assert.equal((await pdf.getMetadata()).info.Title, document.title);
    assert.ok(text.isWellFormed());
    assert.deepEqual(document, before, 'Export must not rewrite stored notes to hide damaged text');
    const operators = await page.getOperatorList();
    assert.ok(!operators.fnArray.includes(pdfjs.OPS.paintImageXObject));
  } finally { await task.destroy(); }
});

test('inline Adam formulas share browser line layout with prose at both reading widths', async () => {
  for (const options of [{ articleWidth: 820, viewportWidth: 1440, fontSize: 17 }, { articleWidth: 560, viewportWidth: 1024, fontSize: 21 }]) {
    const { browser, page } = await openPrintPage(inlineMathDocument(), options);
    try {
      const report = await page.evaluate(() => {
        const rect = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        const failures = [];
        const formulas = [...document.querySelectorAll('.math-inline')];
        for (const formula of formulas) {
          const svg = formula.querySelector('svg').getBoundingClientRect();
          const wrapper = formula.getBoundingClientRect();
          if (svg.left < wrapper.left - .5 || svg.right > wrapper.right + .5) failures.push('SVG overflows its reserved width');
          const paragraph = formula.closest('p');
          const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode;
            if (text.parentElement.closest('.math-node')) continue;
            const range = document.createRange(); range.selectNodeContents(text);
            for (const r of range.getClientRects()) {
              if (Math.min(r.right, svg.right) - Math.max(r.left, svg.left) > 1 && Math.min(r.bottom, svg.bottom) - Math.max(r.top, svg.top) > 1) failures.push({ svg: rect(svg), text: rect(r) });
            }
          }
        }
        return { formulas: formulas.length, failures, width: document.querySelector('article').getBoundingClientRect().width, fontSize: getComputedStyle(document.querySelector('.note-prose')).fontSize };
      });
      assert.ok(report.formulas > 15);
      assert.deepEqual(report.failures, [], 'Math must not overlap prose or escape the space reserved by browser layout');
      assert.equal(report.width, options.articleWidth);
      assert.equal(report.fontSize, `${options.fontSize}px`);
    } finally { await browser.close(); }
  }
  const document = inlineMathDocument();
  document.chapters[0].content.content = [paragraph(String.raw`前文\(\frac{\hat m_t}{\sqrt{\hat v_t}}\)后文。`)];
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await renderLearningPDF(document, { articleWidth: 820 })), useSystemFonts: true });
  try {
    const pdf = await task.promise, page = await pdf.getPage(1);
    const items = (await page.getTextContent()).items.map(item => ({ ...item, str: prose(item.str || '') }));
    const before = items.find(i => i.str.includes('前')), after = items.find(i => i.str.includes('后'));
    assert.ok(before && after);
    assert.ok(after.transform[4] - (before.transform[4] + before.width) > 12, 'PDF must reserve visible space for the inline fraction');
    assert.ok(Math.abs(before.transform[5] - after.transform[5]) < .1, 'Text on either side retains one baseline');
  } finally { await task.destroy(); }
});

test('print HTML escapes note content and shares reader styles without loading remote resources', async () => {
  const document = inlineMathDocument();
  document.title = '<script>alert(1)</script>';
  document.chapters[0].content.content.push(paragraph('<img src="https://example.com/leak">'));
  const html = await printHTML(document);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.doesNotMatch(html, /<script|<img|@import/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /\.math-inline\{display:inline-block/);
  assert.match(html, /:root\{font-family:Inter/);
});

test('long titles keep PDF prose centered at full size with one paper color to every edge', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const options of [{ articleWidth: 820, viewportWidth: 1440 }, { articleWidth: 560, viewportWidth: 1024 }]) {
    const document = inlineMathDocument();
    const longTitle = 'ImageNetClassificationWithDeepConvolutionalNeuralNetworksAndOptimization';
    document.title = longTitle;
    document.chapters[0].title = longTitle;
    document.chapters[0].content.content.unshift(paragraph('MarginProbe'));
    const { browser, page } = await openPrintPage(document, options);
    try {
      const layout = await page.evaluate(() => {
        const article = document.querySelector('article');
        const rect = article.getBoundingClientRect();
        const style = getComputedStyle(article);
        const heading = document.querySelector('.flow-chapter-heading>div').getBoundingClientRect();
        return { padding: [style.paddingLeft, style.paddingRight],
          headingFits: heading.left >= rect.left && heading.right <= rect.right,
          colors: [document.documentElement, document.body].map(el => getComputedStyle(el).backgroundColor) };
      });
      assert.equal(layout.padding[0], layout.padding[1]);
      assert.ok(layout.headingFits, 'A long heading must wrap rather than widen and shrink the printed page');
      assert.deepEqual(layout.colors, ['rgb(252, 251, 247)', 'rgb(252, 251, 247)']);
    } finally { await browser.close(); }
    const task = pdfjs.getDocument({ data: new Uint8Array(await renderLearningPDF(document, options)), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const probe = (await page.getTextContent()).items.find(item => item.str === 'MarginProbe');
      assert.ok(probe);
      assert.ok(Math.abs(probe.transform[4] - options.articleWidth * .1 * .75) < 1, 'PDF left margin must match the centered article, without print shrink-to-fit');
      assert.ok(Math.abs(probe.transform[0] - 17 * .75) < .1, 'Overflow must not silently shrink the body font');
      const viewport = page.getViewport({ scale: 1 });
      const canvas = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvasContext: canvas.context, viewport }).promise;
        const samples = [];
        for (const y of [2, Math.floor(viewport.height / 2), Math.floor(viewport.height) - 3]) {
          for (const x of [2, 15, Math.floor(viewport.width) - 16, Math.floor(viewport.width) - 3]) {
            samples.push([...canvas.context.getImageData(x, y, 1, 1).data].slice(0, 3));
          }
        }
        for (const pixel of samples) assert.ok(pixel.every((value, i) => Math.abs(value - [252, 251, 247][i]) <= 2), `Margin background differs from the paper: ${pixel}`);
      } finally { pdf.canvasFactory.destroy(canvas); }
    } finally { await task.destroy(); }
  }
});

test('oversized notes continue on long pages without dropping boundary paragraphs', async () => {
  const document = inlineMathDocument();
  document.chapters[0].content.content = Array.from({ length: 370 }, (_, i) => paragraph(`Boundary-${String(i).padStart(3, '0')} 连续长文保留每一段正文。`));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await renderLearningPDF(document)), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    assert.ok(pdf.numPages >= 2);
    let text = '';
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      assert.ok(page.view[3] <= 14400);
      text += (await page.getTextContent()).items.map(i => i.str).join('');
    }
    for (let i = 0; i < 370; i++) assert.equal(text.split(`Boundary-${String(i).padStart(3, '0')}`).length - 1, 1);
  } finally { await task.destroy(); }
});

test('monochrome exports share reader colors for prose, vector math, paper notes and page margins', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const [theme, paper, text, note] of [
    ['dark', 'rgb(23, 23, 23)', 'rgb(221, 221, 221)', 'rgb(41, 41, 41)'],
    ['light', 'rgb(255, 255, 255)', 'rgb(51, 51, 51)', 'rgb(243, 243, 243)'],
  ]) {
    const doc = inlineMathDocument();
    const { browser, page } = await openPrintPage(doc, { theme, articleWidth: 820 });
    try {
      const colors = await page.evaluate(() => {
        const style = selector => getComputedStyle(document.querySelector(selector));
        return { theme: document.documentElement.dataset.theme,
          paper: [style('html').backgroundColor, style('body').backgroundColor],
          prose: style('.note-prose').color, math: style('.math-render').color,
          note: style('.paper-note').backgroundColor, noteText: style('.paper-note-body').color,
          noteTitle: style('.paper-note-top input').webkitTextFillColor };
      });
      assert.deepEqual(colors, { theme, paper: [paper, paper], prose: text, math: text, note, noteText: text, noteTitle: text });
    } finally { await browser.close(); }
    const task = pdfjs.getDocument({ data: new Uint8Array(await renderLearningPDF(doc, { theme, articleWidth: 820 })), useSystemFonts: true });
    try {
      const pdf = await task.promise, page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvasContext: canvas.context, viewport }).promise;
        const expected = theme === 'dark' ? 23 : 255;
        for (const x of [2, Math.floor(viewport.width) - 3]) {
          const pixel = [...canvas.context.getImageData(x, 2, 1, 1).data].slice(0, 3);
          assert.ok(pixel.every(value => Math.abs(value - expected) <= 2), `${theme} margin differs from paper: ${pixel}`);
        }
      } finally { pdf.canvasFactory.destroy(canvas); }
    } finally { await task.destroy(); }
  }
});
