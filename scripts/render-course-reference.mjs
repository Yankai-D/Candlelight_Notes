import { brand } from '../shared/brand.mjs';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { renderNoteHTML, escapeHTML as e } from '../shared/note-html.mjs';
import { coursePolicy } from '../shared/course-policy.mjs';
import { validateCourseSection, validateCoursePlan } from '../server/course-harness.mjs';
import { referenceRequest, referencePlan, reference, compactReference, sources, fullPlan, courseRequestFixture, sourceNotes } from '../examples/course/descriptive-statistics/reference.mjs';

export function renderCourseReference() {
  validateCoursePlan(courseRequestFixture, fullPlan);
  const variants = [
    { id: 'expanded', label: '展开必要铺垫', profile: '已学基础代数，尚未系统学习描述性统计。', content: reference },
    { id: 'compact', label: '缩短已知计算', profile: '已掌握均值、方差的基本计算，正在复习它们与统计判断的关系。', content: compactReference },
  ];
  const content = variants.map((variant, i) => {
    const validated = validateCourseSection(referenceRequest, referencePlan, 'summary', variant.content);
    return `<section data-variant="${variant.id}"${i ? ' hidden' : ''}><p class="profile">${e(variant.profile)}</p><article>${validated.rendering.blocks.map(node => {
      const origin = validated.provenance.find(p => p.nodeId === node.attrs.id);
      return `<div class="passage">${renderNoteHTML(node)}<div class="source-detail" hidden>${origin.origin === 'supplement' ? '<span>笔记补充 · 合成算例或解释</span>' : origin.sourceRefs.map(ref => {
        const source = sources.find(s => s.id === ref.sourceId), page = source.pages.find(p => p.number === ref.page);
        return `<div><a href="pdf/descriptive-statistics/${e(source.file)}#page=${ref.page}" data-server-href="/api/library/descriptive-statistics-${e(source.id)}/source#page=${ref.page}" target="_blank" rel="noopener">${e({ textbook: '教材', numerical: '数值课件', categorical: '分类课件' }[source.id])} · 选编第 ${ref.page} 页 / 原文第 ${page.originalPage} 页 ↗</a><q>${e(ref.quote)}</q></div>`;
      }).join('')}</div></div>`;
    }).join('')}</article></section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>课程讲义样稿 · ${brand.name}</title><style>
  :root{color-scheme:light;--paper:#fcfbf7;--ink:#303b30;--muted:#74806f;--accent:#426347;--line:#dfe4d8;--wash:#edf0e7}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Serif SC","Songti SC",SimSun,serif}main{max-width:820px;margin:auto;padding:64px 42px 80px}header{border-bottom:1px solid var(--line);padding-bottom:27px;margin-bottom:26px}.eyebrow,.meta,.controls,.profile,.source-detail,details,footer{font-family:system-ui,"Microsoft YaHei",sans-serif}.eyebrow{font-size:12px;letter-spacing:.14em;color:var(--accent)}h1{font-size:31px;font-weight:500;line-height:1.5;margin:19px 0 13px}.meta{font-size:13px;color:var(--muted);line-height:1.9}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:22px;font-size:12px}.segmented{display:flex;gap:4px;padding:4px;background:var(--wash);border-radius:8px}button{border:0;border-radius:5px;padding:9px 12px;color:var(--muted);font:inherit;background:transparent;cursor:pointer}button[aria-pressed=true]{background:var(--paper);color:var(--accent);box-shadow:0 1px 3px #263b2520}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}label{display:flex;align-items:center;gap:7px;color:var(--muted);cursor:pointer}input{accent-color:var(--accent)}.profile{font-size:12px;color:var(--muted);line-height:1.7;margin:0 0 30px}article p{font-size:18px;line-height:2.08;margin:0 0 23px;overflow-wrap:break-word}article strong{color:var(--accent)}.math-node{font-family:serif;line-height:normal;word-break:normal;overflow-wrap:normal}.math-inline{display:inline-block;vertical-align:baseline;max-width:100%}.math-render{display:inline-block;vertical-align:baseline;max-width:100%}.math-render svg{max-width:100%;height:auto;overflow:visible}.math-display{display:block;max-width:100%;overflow-x:auto;text-align:center;margin:14px 0 18px;padding:8px 2px}.math-display .math-render svg{max-width:none}.source-detail{border-left:2px solid var(--line);padding:0 0 0 13px;margin:-9px 0 27px;color:var(--muted);font-size:11px;line-height:1.9}.source-detail>div+div{margin-top:7px}.source-detail q{display:block;quotes:none;overflow-wrap:anywhere}.source-detail a{text-decoration:none}details{border-top:1px solid var(--line);margin-top:32px;padding-top:20px;font-size:13px;line-height:1.9;color:var(--muted)}summary{cursor:pointer;color:var(--accent)}details li{margin-bottom:10px}details h2{font-size:14px;font-weight:600;color:var(--accent);margin-top:24px}footer{font-size:12px;line-height:1.9;color:var(--muted);margin-top:30px}a{color:var(--accent)}.status{border:1px solid var(--line);border-radius:8px;padding:14px 18px;margin-top:18px}.outline{padding-left:22px}.outline span{display:block;font-size:12px}.outline .current{color:var(--accent)}@media(max-width:600px){main{padding:32px 22px 50px}h1{font-size:26px}article p{font-size:17px}.controls{align-items:flex-start;gap:16px}}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}main{padding:24px 38px;max-width:none}.controls,details,.profile,.source-detail{display:none!important}}
  </style></head><body><main><header><div class="eyebrow">${brand.name} · 课程讲义样稿 01</div><h1>从平均值到有意义的数据概括</h1><div class="meta">均值、离散程度与异常值，如何共同回答一个问题。<br>依据 OpenIntro 教材与课件人工编写；作为讲义模板的审阅基准。</div><div class="controls"><div class="segmented" role="group" aria-label="铺垫深度">${variants.map((v, i) => `<button type="button" data-select="${v.id}" aria-pressed="${!i}">${v.label}</button>`).join('')}</div><label><input id="sources" type="checkbox">核对来源</label></div></header>${content}
  <details><summary>整份讲义的规划与验收依据</summary><p>当前仅第二节有基准正文。规划依据固定材料清单制定，没有运行模型或声称全讲义已经完成。</p><ol class="outline">${fullPlan.sections.map(s => `<li${s.id === 'summary' ? ' class="current"' : ''}>${e(s.title)}${s.id === 'summary' ? ' · 当前样稿' : ''}<span>${e(s.purpose)}</span></li>`).join('')}</ol><h2>程序检查</h2><ul>${coursePolicy.hardChecks.map(c => `<li>${e(c)}</li>`).join('')}</ul><h2>对照样稿审读</h2><ul>${coursePolicy.reviewCriteria.map(c => `<li>${e(c)}</li>`).join('')}</ul><div class="status">模板 ${coursePolicy.id} · 文风 ${coursePolicy.voice}<br>结构检查通过不代表讲解质量通过；引文存在不等于它支持全部论断。</div></details>
  <footer>${sourceNotes.map(n => `<p>${e(n)}</p>`).join('')}<p>${sources.map(s => `<a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.title)}</a> · <a href="${e(s.licenseUrl)}" target="_blank" rel="noopener">${e(s.license)}</a>`).join('<br>')}</p></footer></main><script>
  document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-select]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    document.querySelectorAll('[data-variant]').forEach(s => { s.hidden = s.dataset.variant !== button.dataset.select; });
  }));
  document.getElementById('sources').addEventListener('change', event => { document.querySelectorAll('.source-detail').forEach(s => { s.hidden = !event.target.checked; }); });
  if (location.protocol !== 'file:') document.querySelectorAll('[data-server-href]').forEach(a => { a.href = a.dataset.serverHref; });
  </script></body></html>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = renderCourseReference();
  await mkdir('output', { recursive: true });
  await writeFile('output/course-lecture-reference.html', html);
  // Make it available on an already running production server without losing
  // its in-memory API key. The route below handles subsequent server starts.
  try { await access('dist/index.html'); await mkdir('dist/review', { recursive: true }); await writeFile('dist/review/course.html', html); } catch { /* No production build yet. */ }
  console.log('Wrote output/course-lecture-reference.html');
}
