// Candlelight Notes project mark, drawn from basic geometry for this project.
// Not derived from Lucide or another icon library. Keep all brand surfaces in sync.
// Selected design: A, Quiet Candle (静烛), from the 2026-10-18 studies.
export const brandMarkViewBox = '12 7 40 51';
export const brandMarkStroke = 2.4;
export const brandMarkPaths = Object.freeze([
  // An asymmetric flame, with its tip leaning gently to the right.
  'M34 9C34 14 27 16 27 20C27 23 29 25 32 25C35 25 37 23 37 20C37 16 34.5 14 34 9Z',
  // Wick and a slightly concave wax rim.
  'M32 25V29',
  'M26 29Q32 31 38 29V45H26Z',
  // Shallow candle dish, short stem and straight foot.
  'M19 45H45C43 50 38 51 32 51C26 51 21 50 19 45Z',
  'M32 51V55M26 55H38',
]);

export function brandIconSvg(size = 64) {
  if (!Number.isInteger(size) || size < 16 || size > 2048) throw new Error('Brand icon size must be an integer from 16 to 2048');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#2d5143"/><g fill="none" stroke="#f7f3e8" stroke-width="${brandMarkStroke}" stroke-linecap="round" stroke-linejoin="round">${brandMarkPaths.map(d => `<path d="${d}"/>`).join('')}</g></svg>\n`;
}

export function brandSymbolSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${brandMarkViewBox}"><g fill="none" stroke="#2d5143" stroke-width="${brandMarkStroke}" stroke-linecap="round" stroke-linejoin="round">${brandMarkPaths.map(d => `<path d="${d}"/>`).join('')}</g></svg>\n`;
}
