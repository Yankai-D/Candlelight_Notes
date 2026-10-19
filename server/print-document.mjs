import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Lightbulb, GripVertical, FileText } from 'lucide-react';
import { renderNoteHTML, escapeHTML as escape } from '../shared/note-html.mjs';
import { textOf } from '../shared/document.mjs';
import { sourceLabel } from '../shared/bundle-context.mjs';

const icon = (type, size) => renderToStaticMarkup(createElement(type, { size, 'aria-hidden': true }));

// Read the editor's actual styles, including its responsive typography. The
// print view omits controls, but never measures or repositions individual glyphs.
export async function printHTML(document, { fontSize = 17, articleWidth = 920, theme = 'sage' } = {}) {
  const visualTheme = ['sage', 'dark', 'light'].includes(theme) ? theme : 'sage';
  const sidePadding = Math.max(36, Math.min(84, articleWidth * .1));
  const styles = await Promise.all(['../src/styles.css', '../src/learning.css', '../src/themes.css'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const css = styles.join('\n').replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, '');
  let font = '';
  if (process.env.READING_TREE_PDF_FONT) {
    const data = await readFile(process.env.READING_TREE_PDF_FONT);
    font = `@font-face{font-family:ReadingTreeExport;src:url(data:font/ttf;base64,${data.toString('base64')});font-weight:100 900}:root[data-theme]{--serif:ReadingTreeExport,"Noto Serif SC","Songti SC",SimSun,serif}`;
  }
  const render = node => renderNoteHTML(node, { explanation: (node, body) => {
      const attrs = node.attrs || {};
      const origin = attrs.origin === 'example' ? '示例讲解' : attrs.origin === 'user' ? '我的补充' : 'AI 讲解 · 可继续编辑';
      return `<aside class="paper-note"><div class="paper-note-top"><span class="note-symbol">${icon(Lightbulb, 15)}</span><span class="paper-note-kind">小纸条</span><span class="note-dot">·</span><input value="${escape(attrs.title || '换个角度理解')}" disabled></div><div class="paper-note-body">${body}</div><div class="paper-note-foot">${icon(GripVertical, 12)}<span>${origin}</span>${attrs.sourcePages?.length ? `<button>${escape(sourceLabel(document.pages, attrs.sourcePages))}</button>` : ''}</div></aside>`;
  } });
  const chapters = document.chapters.map((chapter, index) => `<section class="flow-chapter" data-note-chapter="${escape(chapter.id)}"><header class="flow-chapter-heading"><span class="flow-chapter-index">${String(index + 1).padStart(2, '0')}</span><div><h2>${escape(chapter.title)}</h2>${chapter.subtitle ? `<p>${escape(chapter.subtitle)}</p>` : ''}</div><span class="chapter-source-link">${icon(FileText, 12)} ${document.entryType === 'note' ? '来源' : `p.${escape(chapter.sourcePages?.[0] || '')}`}</span></header><div class="note-prose">${textOf(chapter.content).trim() ? render(chapter.content) : '<p class="editor-loading">这部分笔记还在等待生长</p>'}</div></section>`).join('');
  return `<!doctype html><html lang="zh-CN" data-theme="${visualTheme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><title>${escape(document.title)}</title><meta name="description" content="${escape(document.intent)}"><style>${css}\n${font}
    html:root,body{width:100%;height:auto;min-height:0;margin:0;background:var(--paper);overflow:visible}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;animation:none!important;transition:none!important}
    .learning-article{width:${articleWidth}px;max-width:100%;margin:0 auto;padding-inline:${sidePadding}px;padding-bottom:48px}
    .article-title,.article-subtitle,.continuous-hint,.flow-chapter-heading{overflow-wrap:anywhere}
    .flow-chapter-heading>div{min-width:0}
    .chapter-source-link{flex-shrink:0}
    .paper-note-controls,.reading-finished{display:none!important}
    .paper-note-top>input{opacity:1;-webkit-text-fill-color:currentColor}
    .note-prose p{orphans:3;widows:3}.flow-chapter-heading{break-after:avoid}.paper-note,.math-display{break-inside:avoid}
    .math-display{overflow:visible}
    @page{margin:0;background:var(--paper)}
  </style></head><body><article class="learning-article continuous-article" style="--prose-size:${fontSize}px"><header class="document-reading-header"><div class="article-kicker"><span>READING NOTES</span><i></i><span>${document.demo ? '原创示例讲义' : '我的学习笔记'}</span></div><h1 class="article-title">${escape(document.title)}</h1><p class="article-subtitle">${escape(document.subtitle)}</p><p class="continuous-hint">${escape(document.notebookLabel || '学习笔记')} · 沿着文章读下去，让理解自然生长。</p></header>${chapters}<div class="chapter-end"><span class="end-flourish">✧</span><p>理解不止于读完，也在于用自己的话说一遍。</p></div></article></body></html>`;
}
