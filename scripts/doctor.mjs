import { access } from 'node:fs/promises';
import { browserPath } from '../server/pdf-export.mjs';
export async function doctor() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('请使用 Node.js 24（版本要求见 .node-version）。');
  await access(new URL('../node_modules/typescript/bin/tsc', import.meta.url)).catch(() => { throw new Error('依赖尚未安装，请先运行 npm ci。'); });
  const browser = browserPath();
  if (process.env.READING_TREE_PDF_FONT) await access(process.env.READING_TREE_PDF_FONT);
  console.log(`Node ${process.versions.node} · ${process.platform}/${process.arch}`);
  console.log(`Browser: ${browser}`);
  console.log('环境检查通过。PDF 中文显示还需要系统中文字体；Linux 安装 fonts-noto-cjk。');
  return { node: process.versions.node, platform: process.platform, arch: process.arch, browser };
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/doctor.mjs')) await doctor();
