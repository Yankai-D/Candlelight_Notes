import { JSDOM } from 'jsdom';
import yauzl from 'yauzl';
import { posix } from 'node:path';
import { materialFormat } from '../shared/material-formats.mjs';
import sourceLimits from '../shared/source-limits.json' with { type: 'json' };

const MAX_XML = 16 * 1024 ** 2, MAX_TEXT = 4 * 1024 ** 2;
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const child = (node, name) => [...(node?.children || [])].find(item => item.localName === name);
const attr = (node, name) => [...(node?.attributes || [])].find(item => item.localName === name)?.value || '';
const compact = text => text.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
function decode(bytes, html = false) {
  const head = bytes.subarray(0, 2048).toString('latin1');
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' :
    (html ? head.match(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i)?.[1] : head.match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1]) || 'utf-8';
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('无法读取文件编码，请另存为 UTF-8 HTML 或新的 Office 文件。'); }
}
async function officeEntries(bytes) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(error) : resolve(zip)));
  return new Promise((resolve, reject) => {
    const files = new Map(), seen = new Set(); let total = 0, count = 0, settled = false;
    const fail = error => { if (!settled) { settled = true; zip.close(); reject(error); } };
    zip.on('error', fail);
    zip.on('end', () => { if (!settled) { settled = true; resolve(files); } });
    zip.on('entry', entry => { void (async () => {
      if (++count > 5000 || seen.has(entry.fileName) || entry.generalPurposeBitFlag & 1) throw new Error('Office 文件过大、已加密或内部结构异常。');
      seen.add(entry.fileName);
      if (!/^(?:word|ppt)\/.*\.(xml|rels)$/.test(entry.fileName)) { zip.readEntry(); return; }
      if (entry.uncompressedSize > MAX_XML || (total += entry.uncompressedSize) > 32 * 1024 ** 2) throw new Error('Office 文件展开后的文字结构过大，请按章节拆分。');
      const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
      const chunks = []; let length = 0;
      for await (const part of stream) { length += part.length; if (length > MAX_XML) { stream.destroy(); throw new Error('Office 内容超过读取限制。'); } chunks.push(part); }
      files.set(entry.fileName, decode(Buffer.concat(chunks))); zip.readEntry();
    })().catch(fail); });
    zip.readEntry();
  });
}
function xml(files, path, callback) {
  const text = files.get(path);
  if (!text || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Office 文件结构不完整或包含不支持的 XML 声明。');
  const dom = new JSDOM(text, { contentType: 'text/xml' });
  try {
    if (dom.window.document.getElementsByTagName('*').length > 150000) throw new Error('Office 文档结构过于复杂，请拆分后导入。');
    return callback(dom.window.document);
  } finally { dom.window.close(); }
}
// Common Office equations are retained as LaTeX in the shared source text.
// Unsupported constructs remain visible as text and are explicitly reported.
function math(node, warnings) {
  if (!node) return '';
  const name = node.localName, children = [...node.children], read = n => math(child(node, n), warnings);
  if (name === 't') return node.textContent.replace(/([#$%&_{}])/g, '\\$1');
  if (/Pr$/.test(name)) return '';
  if (name === 'f') return `\\frac{${read('num')}}{${read('den')}}`;
  if (name === 'sSup') return `{${read('e')}}^{${read('sup')}}`;
  if (name === 'sSub') return `{${read('e')}}_{${read('sub')}}`;
  if (name === 'sSubSup') return `{${read('e')}}_{${read('sub')}}^{${read('sup')}}`;
  if (name === 'rad') return `\\sqrt${read('deg') ? `[${read('deg')}]` : ''}{${read('e')}}`;
  if (name === 'd') {
    const props = child(node, 'dPr');
    const delimiter = (value, fallback) => value === undefined ? fallback : ({ '{': '\\{', '}': '\\}', '': '.' }[value] || value);
    const start = child(props, 'begChr'), end = child(props, 'endChr');
    return `\\left${delimiter(start ? attr(start, 'val') : undefined, '(')}${children.filter(c => c.localName === 'e').map(c => math(c, warnings)).join(',')}\\right${delimiter(end ? attr(end, 'val') : undefined, ')')}`;
  }
  if (name === 'nary') { const symbol = attr(child(child(node, 'naryPr'), 'chr'), 'val') || '∫'; return `${({ '∑': '\\sum', '∏': '\\prod', '∫': '\\int' })[symbol] || symbol}_{${read('sub')}}^{${read('sup')}} ${read('e')}`; }
  if (!['oMath', 'oMathPara', 'r', 'e', 'num', 'den', 'sup', 'sub', 'deg'].includes(name)) warnings.add('部分复杂公式按文字保留，请对照原文件核查；常见分式、上下标与根式已转换。');
  return children.map(n => math(n, warnings)).join('');
}
function wordParagraph(p, warnings) {
  function walk(node) {
    if (node.nodeType !== 1) return '';
    if (['del', 'moveFrom', 'instrText', 'pPr', 'rPr'].includes(node.localName)) return '';
    if (node.localName === 'oMath') return `$${math(node, warnings)}$`;
    if (node.localName === 't') return node.textContent;
    if (node.localName === 'tab') return '\t';
    if (['br', 'cr'].includes(node.localName)) return '\n';
    return [...node.children].map(walk).join('');
  }
  return compact(walk(p));
}
function word(files, warnings) {
  const styles = new Map();
  if (files.has('word/styles.xml')) xml(files, 'word/styles.xml', doc => elements(doc, 'style').forEach(style => {
    const id = attr(style, 'styleId'), name = attr(child(style, 'name'), 'val');
    const level = attr(child(child(style, 'pPr'), 'outlineLvl'), 'val');
    if (level !== '' && Number(level) < 6) styles.set(id, Number(level) + 1);
    else if (/^(heading|标题)\s*[1-6]$/i.test(name)) styles.set(id, Number(name.match(/[1-6]$/)[0]));
  }));
  return xml(files, 'word/document.xml', doc => {
    if (elements(doc, 'drawing').length || elements(doc, 'pict').length) warnings.add('图片、图表和文本框版式未转换；请保留并对照原件。');
    if (elements(doc, 'altChunk').length || elements(doc, 'object').length) warnings.add('嵌入对象未提取，请在原文件中核查。');
    if (elements(doc, 'footnoteReference').length || elements(doc, 'endnoteReference').length) warnings.add('脚注与尾注请查看原件，本次提取正文。');
    const sections = []; let title = '开篇', blocks = [];
    const flush = () => { if (blocks.length) sections.push({ title, text: blocks.join('\n\n') }); blocks = []; };
    for (const p of elements(doc, 'p').filter(p => !p.parentElement?.closest('p') && !elements(p, 'p').length)) {
      const text = wordParagraph(p, warnings); if (!text) continue;
      const props = child(p, 'pPr'), style = attr(child(props, 'pStyle'), 'val');
      const level = styles.get(style) || Number(style.match(/^(?:heading|标题)\s*([1-6])$/i)?.[1] || 0);
      if (level && level <= 2) { flush(); title = text.slice(0, 100); }
      blocks.push(level ? '#'.repeat(level) + ' ' + text : child(props, 'numPr') ? '- ' + text : text);
    }
    if (elements(doc, 'tbl').length) warnings.add('表格内容按单元格顺序提取，合并单元格及表格版式请对照原件。');
    flush(); return sections;
  });
}
function slides(files, warnings) {
  const relationships = xml(files, 'ppt/_rels/presentation.xml.rels', doc => new Map(elements(doc, 'Relationship').filter(r => attr(r, 'TargetMode') !== 'External').map(r => [attr(r, 'Id'), attr(r, 'Target')])));
  const paths = xml(files, 'ppt/presentation.xml', doc => elements(doc, 'sldId').map(slide => {
    const id = [...slide.attributes].find(a => a.localName === 'id' && a.namespaceURI?.includes('relationships'))?.value;
    const target = relationships.get(id); if (!target) throw new Error('课件缺少幻灯片定位。');
    const path = posix.normalize(target.startsWith('/') ? target.slice(1) : 'ppt/' + target);
    if (!/^ppt\/slides\/[^/]+\.xml$/.test(path)) throw new Error('课件幻灯片路径异常。');
    return path;
  }));
  if (!paths.length || paths.length > sourceLimits.maxPages) throw new Error(`课件为空或超过 ${sourceLimits.maxPages} 页，请拆分后导入。`);
  warnings.add('课件按幻灯片顺序提取文字；图片、图表、动画与演讲者备注未转换。');
  let readable = false;
  const sections = paths.map((path, index) => xml(files, path, doc => {
    const lines = elements(doc, 'p').map(p => [...p.children].map(node => node.localName === 'br' ? '\n' : elements(node, 't').map(t => t.textContent).join('')).join('')).map(compact).filter(Boolean);
    if (lines.length) readable = true;
    return { title: `第 ${index + 1} 张 · ${lines[0]?.slice(0, 70) || '无可提取文字'}`, text: lines.join('\n\n') || '[此页无可提取文字，请查看原课件中的图片或图表。]' };
  }));
  if (!readable) throw new Error('课件没有可提取的文字，当前暂不支持图片 OCR。');
  return sections;
}
function html(bytes, warnings) {
  const dom = new JSDOM(decode(bytes, true));
  try {
    const doc = dom.window.document;
    if (doc.getElementsByTagName('*').length > 150000) throw new Error('网页结构过于复杂，请保存正文部分再导入。');
    // Legacy MathJax stores TeX as inert script data, not executable JavaScript.
    doc.querySelectorAll('script[type]').forEach(node => {
      const type = node.getAttribute('type').trim();
      if (/^math\/tex(?:\s*;\s*mode\s*=\s*display)?$/i.test(type)) node.replaceWith(/display/i.test(type) ? `\\[${node.textContent}\\]` : `\\(${node.textContent}\\)`);
    });
    // Quiz questions and options often live INSIDE forms. Drop controls and
    // scripts, not their surrounding authored content. Never submit a form.
    if (doc.querySelector('form,input,select,textarea,button')) warnings.add('网页交互控件仅保留静态题干和文字选项；未执行脚本或提交表单，动态加载的题目需核对原网页。');
    doc.querySelectorAll('script,style,noscript,iframe,object,embed,input,button,nav,footer,aside,template,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
    const root = doc.querySelector('main,article') || doc.body;
    if (root.querySelector('img,svg,canvas,video,audio')) warnings.add('网页图片、图表及音视频未转换；图片替代文字会保留，未访问外部链接。');
    root.querySelectorAll('img').forEach(node => node.replaceWith(node.getAttribute('alt') ? `[图片：${node.getAttribute('alt')}]` : ''));
    root.querySelectorAll('svg,canvas,video,audio').forEach(node => node.remove());
    root.querySelectorAll('math').forEach(node => { const tex = node.querySelector('annotation[encoding="application/x-tex"]'); if (tex) node.replaceWith(`$${tex.textContent}$`); else { warnings.add('网页含未转换的 MathML 公式，请对照原网页核查。'); node.replaceWith(`[公式原文：${node.textContent}]`); } });
    const sections = [], listPositions = new WeakMap(); let title = doc.title.trim().slice(0,100) || '网页正文', text = '';
    const flush = () => { const content = compact(text); if (content) sections.push({ title, text: content }); text = ''; };
    function walk(node) {
      if (node.nodeType === 3) { text += node.textContent; return; }
      if (node.nodeType !== 1) return;
      const tag = node.localName;
      if (/^h[12]$/.test(tag)) { flush(); title = compact(node.textContent).slice(0,100) || title; }
      if (/^h[1-6]$/.test(tag)) text += '\n\n' + '#'.repeat(Number(tag[1])) + ' ';
      if (tag === 'li') {
        const list = node.parentElement;
        let number = Number(node.getAttribute('value') ?? listPositions.get(list) ?? list.getAttribute('start') ?? 1);
        if (!Number.isSafeInteger(number)) number = 1;
        listPositions.set(list, number + 1);
        text += list.localName === 'ol' ? `\n${number}. ` : '\n- ';
      }
      if (tag === 'option') text += '\n- ';
      if (['td','th'].includes(tag)) text += ' | ';
      if (tag === 'br') text += '\n';
      for (const part of node.childNodes) walk(part);
      if (/^(p|div|section|article|blockquote|pre|table|tr|form|fieldset|legend|label|select|textarea|h[1-6])$/.test(tag)) text += '\n\n';
    }
    walk(root); flush(); return sections;
  } finally { dom.window.close(); }
}
export async function parseMaterial({ name, data }) {
  const format = materialFormat(name);
  if (!format || !['docx','pptx','html'].includes(format.extension)) throw new Error('请选择 DOCX、PPTX 或 HTML 文件；旧版 DOC/PPT 请先另存为新格式。');
  if (typeof data !== 'string' || data.length > 72 * 1024 ** 2) throw new Error('资料最大 50 MB。');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > 50 * 1024 ** 2) throw new Error('资料为空或超过 50 MB。');
  const warnings = new Set();
  let sections;
  try { sections = format.extension === 'html' ? html(bytes, warnings) : format.extension === 'docx' ? word(await officeEntries(bytes), warnings) : slides(await officeEntries(bytes), warnings); }
  catch (error) { if (/[\u4e00-\u9fff]/.test(error.message)) throw error; throw new Error('无法读取文件结构，请确认文件未损坏、未加密，并另存为标准 DOCX、PPTX 或 HTML 后重试。'); }
  const length = sections.reduce((sum, section) => sum + section.text.length, 0);
  if (!length) throw new Error('没有可提取的正文，请使用包含文字的文件；扫描件暂不支持 OCR。');
  if (length > MAX_TEXT || sections.length > sourceLimits.maxPages) throw new Error('提取内容过长，请按章节拆分后导入。');
  return { sections, warnings: [...warnings] };
}
