import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
// Deliberately exclude HTML, URL, image, and dynamic package-loading commands.
const processor = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams', 'newcommand'], maxBuffer: 12000, maxMacros: 1000,
    formatError: (_jax, error) => { throw error; } }),
  OutputJax: new SVG({ fontCache: 'none' }),
});
const cache = new Map();
export function renderMath(latex, display = false) {
  if (!latex?.trim() || latex.length > 12000) throw new Error('公式为空或过长');
  if (/\\(?:href|url|style|class|cssId|html\w*|require|includegraphics)\b/.test(latex)) throw new Error('公式包含不支持的命令');
  const key = `${display}:${latex}`;
  if (cache.has(key)) return cache.get(key);
  processor.inputJax[0].parseOptions.tags.reset();
  const container = processor.convert(latex, { display, em: 16, ex: 8, containerWidth: 700 });
  const svg = adaptor.firstChild(container);
  const result = { svg: adaptor.outerHTML(svg), width: parseFloat(adaptor.getAttribute(svg, 'width')), height: parseFloat(adaptor.getAttribute(svg, 'height')),
    depth: Math.max(0, -(parseFloat(adaptor.getStyle(svg, 'vertical-align')) || 0)) };
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

export { mathText, parseMath, mathifyNode } from './math-syntax.mjs';
