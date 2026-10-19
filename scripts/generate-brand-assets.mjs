import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { brandIconSvg, brandSymbolSvg } from '../shared/brand-mark.mjs';
import { renderBrandIcon, writeBrandIcons } from './lib/brand-icons.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'output/brand');
await mkdir(output, { recursive: true });
await writeFile(join(root, 'public/favicon.svg'), brandIconSvg());
await writeFile(join(output, 'candlelight-symbol.svg'), brandSymbolSvg());
await writeFile(join(output, 'candlelight-icon.svg'), brandIconSvg());
const frames = await writeBrandIcons(output);
for (const { size, png } of frames) await writeFile(join(output, `candlelight-${size}.png`), png);
await writeFile(join(output, 'candlelight-1024.png'), await renderBrandIcon(1024));
console.log(JSON.stringify({ output, sizes: frames.map(frame => frame.size), favicon: 'public/favicon.svg' }));
