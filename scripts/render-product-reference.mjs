import { brand } from '../shared/brand.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {validateResult} from '../server/harness.mjs';
import {renderNoteHTML,escapeHTML as esc} from '../shared/note-html.mjs';
import {reference} from '../evals/notes/runs/2026-10-18-evidence/reference.mjs';
import {root} from './lib/process.mjs';

const archive=JSON.parse(await readFile(new URL('../evals/notes/runs/2026-10-18-evidence/run.json',import.meta.url),'utf8'));
const item=archive.plan.cases.find(c=>c.materialId==='resnet-residual');
for(const change of reference.changes) {
  const candidate=archive.candidates.find(c=>c.id===change.candidateId);
  if(!candidate?.result?.blocks?.[change.block-1]?.text.includes(change.quote)) throw new Error('Editorial change lost its original paragraph anchor');
}
const result=validateResult(item.request,{blocks:reference.paragraphs.map(text=>({type:'paragraph',text,sourcePages:[3],sourceQuote:''})),summary:'AI 协作编辑样稿，待人工审阅'});
const directory=resolve(root,'artifacts/product-reference');await mkdir(directory,{recursive:true});
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${brand.name} · ResNet 编辑样稿</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fbfaf6;color:#2d3e32;font:16px/1.9 system-ui,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:auto;padding:40px 48px 80px}h1{font-size:30px;line-height:1.45}header{border-bottom:1px solid #dce3d8;margin-bottom:32px;padding-bottom:24px}.notice{padding:14px 18px;background:#e8eddf;border-radius:8px;font-size:14px}.note{font:19px/2 Georgia,"Noto Serif SC",SimSun,serif}.note p{margin:0 0 26px}.math-display{display:block;overflow:auto;text-align:center;margin:18px 0}.math-inline{display:inline-block}.math-node svg{max-width:100%}details{padding:20px 0;border-top:1px solid #dce3d8}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.8 ui-monospace,monospace}small{color:#697569}li{margin:12px 0}@media(max-width:600px){main{padding:24px}.note{font-size:18px}h1{font-size:25px}}
</style></head><body><main><header><small>${brand.name} · 待审阅的编辑样稿</small><h1>${esc(reference.title)}</h1><p>${esc(reference.goal)}</p><p class="notice">这是 AI 协作者依据来源修订的样稿，供讨论表达与事实边界；不是模型直接输出，不是独立人工认可的标准答案，未加入生产模板。正文和公式使用产品共用渲染器。</p></header>
<article class="note">${result.rendering.blocks.map(node=>renderNoteHTML(node)).join('')}</article>
<details><summary>修改依据与生成来源</summary><p>原候选来自运行 ${esc(archive.id)}；以下是 AI 开发观察，尚待独立核对。</p><ul>${reference.changes.map(c=>`<li>原段 ${c.block}：“${esc(c.quote)}”。${esc(c.reason)}</li>`).join('')}</ul><p>人工审阅重点：局部公式是否帮助理解研究问题，条件是否自然融入正文，解释是否充分且不过量。你的风格偏好可作为下一轮样稿要求；不要把这份编辑稿计入模型胜率。</p></details>
<details><summary>来源原文 · PDF 第 3 页 §3.1 及脚注</summary><p>${esc(item.material.provenance.attribution)}</p><p>${esc(item.material.provenance.license)}</p><p>${esc(item.material.provenance.adaptation)}</p>${item.material.pages.map(p=>`<pre>${esc(p.text)}</pre>`).join('')}</details>
</main></body></html>`;
await writeFile(join(directory,'reference.html'),html);
await writeFile(join(directory,'reference.json'),JSON.stringify({reference,sourceRun:archive.id,sourceArtifactHash:archive.artifactHash,result},null,2)+'\n');
console.log(`AI-edited reference, no model calls: ${join(directory,'reference.html')}`);
