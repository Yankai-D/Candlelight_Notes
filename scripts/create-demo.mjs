import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';
import { sourcePages } from '../src/demo.ts';

const pdf = await PDFDocument.create();
pdf.setTitle('A Short Guide to Attention — Candlelight Notes');
pdf.setAuthor('Candlelight Notes · Original teaching example');
const regular = await pdf.embedFont(StandardFonts.TimesRoman);
const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
const sans = await pdf.embedFont(StandardFonts.Helvetica);
const ink = rgb(0.18, 0.25, 0.21), muted = rgb(0.43, 0.47, 0.43);
for (const source of sourcePages) {
  const page = pdf.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.995, 0.99, 0.975) });
  page.drawText('CANDLELIGHT NOTES  /  FIELD NOTES', { x: 58, y: 790, size: 9, font: sans, color: muted });
  page.drawLine({ start: { x: 58, y: 774 }, end: { x: 537, y: 774 }, thickness: 0.6, color: rgb(0.76, 0.79, 0.74) });
  const parts = source.text.split('\n\n');
  let y = 726;
  for (let i = 0; i < parts.length; i++) {
    const font = i === 0 ? bold : regular;
    const size = i === 0 ? 23 : 12.5;
    for (const line of parts[i].split('\n')) {
      let current = '';
      for (const word of line.split(' ')) {
        if (font.widthOfTextAtSize((current ? current + ' ' : '') + word, size) > 470) {
          page.drawText(current, { x: 58, y, size, font, color: ink }); y -= size * 1.5; current = word;
        } else current += (current ? ' ' : '') + word;
      }
      if (current) { page.drawText(current, { x: 58, y, size, font, color: ink }); y -= size * 1.5; }
    }
    y -= 17;
  }
  page.drawLine({ start: { x: 58, y: 64 }, end: { x: 537, y: 64 }, thickness: 0.6, color: rgb(0.76, 0.79, 0.74) });
  page.drawText('An original teaching example. Not a published paper.', { x: 58, y: 46, size: 8, font: sans, color: muted });
  page.drawText(String(source.number).padStart(2, '0'), { x: 521, y: 46, size: 9, font: sans, color: muted });
}
await mkdir('public', { recursive: true });
await writeFile('public/attention-field-notes.pdf', await pdf.save());
console.log('Created six-page original example PDF.');
