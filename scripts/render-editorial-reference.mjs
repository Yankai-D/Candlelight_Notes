import { brand } from '../shared/brand.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseMath, renderMath } from '../shared/math.mjs';
import { editorialPolicy } from '../shared/editorial-policy.mjs';
import { adamBiasCorrection as example } from '../examples/editorial/adam-bias-correction.mjs';

const escape = text => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const prose = text => parseMath(text).map(part => part.type === 'math'
  ? `<span class="math${part.attrs.display ? ' display' : ''}" role="math" aria-label="${escape(part.attrs.latex)}">${renderMath(part.attrs.latex, part.attrs.display).svg}</span>`
  : escape(part.text)).join('');

export function renderEditorialReference() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>适应学习文风样稿 · ${brand.name}</title><style>
  :root{color-scheme:light;--paper:#fcfbf7;--ink:#303b30;--muted:#73816d;--accent:#426347;--line:#dfe4d8}
  *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Serif SC","Songti SC",SimSun,serif}main{max-width:820px;margin:auto;padding:60px 40px 80px}header{border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:32px}.eyebrow, .meta, .controls, details, footer{font-family:system-ui,"Microsoft YaHei",sans-serif}.eyebrow{font-size:12px;letter-spacing:.15em;color:var(--accent)}h1{font-size:30px;font-weight:500;margin:18px 0 14px;line-height:1.5}.meta{font-size:13px;line-height:1.9;color:var(--muted)}.controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:22px;font-size:13px}select{max-width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--accent)}.profile{margin:0 0 32px;color:var(--muted);font-size:13px;font-family:system-ui,"Microsoft YaHei",sans-serif}article p{font-size:18px;line-height:2.05;margin:0 0 22px;text-align:left;overflow-wrap:break-word}.math{display:inline-block;vertical-align:baseline;max-width:100%;line-height:1.3}.math svg{max-width:100%;overflow:visible}.math.display{display:block;overflow-x:auto;text-align:center;padding:14px 4px;margin:8px 0}.math.display svg{max-width:none}details{border-top:1px solid var(--line);margin-top:38px;padding-top:22px;font-size:13px;line-height:1.9;color:var(--muted)}summary{cursor:pointer;color:var(--accent)}details li{margin-bottom:12px}footer{margin-top:26px;font-size:12px;line-height:1.9;color:var(--muted)}a{color:var(--accent)}[hidden]{display:none!important}@media(max-width:600px){main{padding:30px 22px 50px}h1{font-size:25px}article p{font-size:17px}}@media print{main{padding:0;max-width:none}.controls,details{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><main><header><div class="eyebrow">${brand.name} · 适应学习文风样稿</div><h1>${escape(example.title)}</h1><div class="meta">同一套笔记文风，按知识背景展开必要解释。<br>人工编写的章节范文，供审阅与后续调教参考。</div><div class="controls"><label for="reader">阅读背景</label><select id="reader">${example.variants.map(variant => `<option value="${escape(variant.id)}">${escape(variant.label)}</option>`).join('')}</select></div></header>${example.variants.map((variant, index) => `<section data-variant="${escape(variant.id)}"${index ? ' hidden' : ''}><p class="profile">${escape(variant.background)}</p><article>${variant.paragraphs.map(paragraph => `<p data-paragraph="${escape(paragraph.id)}">${prose(paragraph.text)}</p>`).join('')}</article></section>`).join('')}<details><summary>查看编写规范与审阅要点</summary><ul>${[...editorialPolicy.invariants, ...editorialPolicy.pacing, ...example.reviewCriteria].map(rule => `<li>${escape(rule)}</li>`).join('')}</ul></details><footer>来源：<a href="${escape(example.source.url)}">${escape(example.source.title)}</a>，第 3 节及算法 1，第 ${example.source.pages.join('、')} 页。<p>${escape(example.sourceNote)}</p></footer></main><script>
  document.getElementById('reader').addEventListener('change', event => {
    document.querySelectorAll('[data-variant]').forEach(section => { section.hidden = section.dataset.variant !== event.target.value; });
  });
  </script></body></html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir('output', { recursive: true });
  await writeFile('output/editorial-reference.html', renderEditorialReference());
  console.log('Wrote output/editorial-reference.html');
}
