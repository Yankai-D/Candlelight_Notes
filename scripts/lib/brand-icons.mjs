import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { brandIconSvg } from '../../shared/brand-mark.mjs';

export async function renderBrandIcon(size) {
  // Decode the SVG at its final pixel size, never upscale a 64px raster.
  const image = await loadImage(Buffer.from(brandIconSvg(size)));
  if (image.width !== size || image.height !== size) throw new Error('Unexpected brand icon raster size');
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toBuffer('image/png');
}

export async function writeBrandIcons(directory) {
  await mkdir(directory, { recursive: true });
  const frames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) frames.push({ size, png: await renderBrandIcon(size) });
  await writeFile(join(directory, 'icon.png'), frames.at(-1).png);
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const base = 6 + index * 16;
    header[base] = header[base + 1] = size % 256;
    header.writeUInt16LE(1, base + 4); header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(png.length, base + 8); header.writeUInt32LE(offset, base + 12);
    offset += png.length;
  });
  await writeFile(join(directory, 'icon.ico'), Buffer.concat([header, ...frames.map(frame => frame.png)]));
  return frames;
}
