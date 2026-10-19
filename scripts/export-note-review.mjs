import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launch } from 'puppeteer-core';
import { browserPath } from '../server/pdf-export.mjs';
import { reviewPrintCSS, prepareReviewPrint } from '../evals/notes/print.mjs';

const { values } = parseArgs({ options: {
  input: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('node scripts/export-note-review.mjs --input path/to/review.html --out output/pdf/review.pdf');
} else {
  if (!values.input || !values.out) throw new Error('Provide --input review.html and --out output/pdf/review.pdf');
  const input = resolve(values.input), output = resolve(values.out);
  if (!/\.pdf$/i.test(output)) throw new Error('--out must be a .pdf file');
  if (input === output) throw new Error('Input and output must be different files');
  const html = await readFile(input, 'utf8');
  // No app session, .env, cookies, network, or page-authored JavaScript.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|systemroot|windir|temp|tmp|localappdata|userprofile|home|lang|display|xdg_runtime_dir)$/i.test(key)));
  const browser = await launch({ executablePath: browserPath(), headless: true, pipe: true, env,
    timeout: 30000, args: ['--disable-background-networking'] });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.emulateMediaType('screen');
    await page.setRequestInterception(true);
    page.on('request', request => { void (request.url().startsWith('data:') ? request.continue() : request.abort()); });
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    if (!await page.$('main .columns article')) throw new Error('Input is not a note comparison review page');
    await page.addStyleTag({ content: reviewPrintCSS + '\n@page { size: auto; margin: 0; }' });
    await page.evaluate(prepareReviewPrint);
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => {
      const main = document.querySelector('main');
      const overflowing = [...document.querySelectorAll('article, .note, .math-display')]
        .some(element => element.scrollWidth > element.clientWidth + 2);
      return { height: Math.ceil(main.getBoundingClientRect().height) + 2,
        candidates: document.querySelectorAll('.columns article').length,
        math: document.querySelectorAll('[role="math"] svg').length,
        invalidMath: document.querySelectorAll('.math-invalid').length,
        overflowing: overflowing || document.body.scrollWidth > innerWidth + 2 };
    });
    if (metrics.overflowing || metrics.invalidMath) {
      throw new Error(`Review has clipped content or invalid math: ${JSON.stringify(metrics)}`);
    }
    // Preserve the desktop A/B layout on a continuous page. For very large
    // reviews, Chromium paginates within the portable PDF page-size limit.
    const height = Math.min(18000, Math.max(400, metrics.height));
    if (metrics.height > height) await page.addStyleTag({ content: '@page { margin: 32px 0; }' });
    const pdf = await page.pdf({ width: '1440px', height: `${height}px`, scale: 1,
      printBackground: true, displayHeaderFooter: false, preferCSSPageSize: false, timeout: 60000 });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, pdf);
    console.log(JSON.stringify({ output, ...metrics, bytes: pdf.length, modelCalls: 0 }, null, 2));
  } finally { await browser.close(); }
}
