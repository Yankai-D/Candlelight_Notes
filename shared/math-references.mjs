import adam from './adam-math.json' with { type: 'json' };
import { parseMath, mathText, mathifyNode } from './math-syntax.mjs';

const compact = text => text.replace(/\s/g, '');
function references(document) {
  // Match both paper identity and source evidence, never a chapter number alone.
  if (!/adam.*stochastic optimization/i.test(document.title)) return [];
  if (!document.pages.some(p => p.number === 4 && /Our Theorem 4\.1/.test(p.text) && /Zinkevich/.test(p.text))) return [];
  return adam.formulas.filter(ref => document.pages.some(p => p.number === ref.page && compact(p.text).includes(compact(ref.extracted))));
}
export function formulaReferences(document, pageNumbers) {
  return references(document).filter(ref => pageNumbers.includes(ref.page)).map(({ page, extracted, latex, display }) => ({ page, extracted, latex, display }));
}

function replacePlain(text, refs) {
  const positions = [], chars = [];
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { positions.push(i); chars.push(text[i]); }
  const joined = chars.join(''), matches = [];
  for (const ref of refs) for (const raw of [ref.extracted, ...ref.aliases]) {
    const needle = compact(raw);
    for (let index = joined.indexOf(needle); index >= 0; index = joined.indexOf(needle, index + needle.length)) {
      matches.push({ start: positions[index], end: positions[index + needle.length - 1] + 1, ref });
    }
  }
  // Prefer the complete expression to a smaller formula occurring inside it.
  const accepted = [];
  for (const match of matches.sort((a,b) => (b.end-b.start) - (a.end-a.start))) {
    if (!accepted.some(other => match.start < other.end && match.end > other.start)) accepted.push(match);
  }
  let result = text;
  for (const { start, end, ref } of accepted.sort((a,b) => b.start-a.start)) result = result.slice(0,start) + mathText({ type: 'math', attrs: { latex: ref.latex, display: ref.display } }) + result.slice(end);
  return result;
}
export function restoreReferencedMath(text, refs) {
  // Existing LaTeX is explicit author content. Do not run matching inside it.
  return parseMath(text).map(part => part.type === 'math' ? mathText(part) : replacePlain(part.text, refs)).join('');
}
export function upgradeMathDocument(document, now = Date.now()) {
  if (document.mathTypesetVersion >= 1) return document;
  const refs = references(document);
  function upgrade(node, personal = false) {
    if (node.type === 'codeBlock' || node.type === 'math' || node.marks?.some(m => m.type === 'code')) return node;
    if (node.type === 'text') {
      const text = personal ? node.text : restoreReferencedMath(node.text, refs);
      return text === node.text ? node : { ...node, text };
    }
    if (!node.content) return node;
    const content = node.content.map(child => upgrade(child, personal || node.type === 'explanation'));
    return mathifyNode(content.every((n,i) => n === node.content[i]) ? node : { ...node, content });
  }
  const chapters = document.chapters.map(chapter => {
    const content = upgrade(chapter.content);
    return content === chapter.content ? chapter : { ...chapter, content };
  });
  if (chapters.every((chapter,i) => chapter === document.chapters[i])) return document;
  return { ...document, chapters, mathTypesetVersion: 1, revision: document.revision + 1, updatedAt: now,
    versions: [{ id: crypto.randomUUID(), time: now, label: '修复公式结构与排版之前', chapters: structuredClone(document.chapters) }, ...document.versions].slice(0,20) };
}
