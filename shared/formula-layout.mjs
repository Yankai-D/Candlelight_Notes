const mathSymbols = /[=+−\-*/^_<>≤≥≠≈≜≡∑ΣΠ∏∫√∞∥⊙∇]/u;
const relation = /^[=<>≤≥≠≈≡⇒⇔]/u;
const functions = new Set(['sin', 'cos', 'tan', 'log', 'exp', 'lim', 'max', 'min', 'inf', 'sup', 'arg', 'det', 'diag', 'rank', 'sqrt']);

function mathLine(line) {
  if (!line || /[\p{Script=Han}，。；：！？]/u.test(line.replace(/[，。；]+$/, ''))) return false;
  // Long prose words are not formula fragments. TeX commands themselves may
  // be long, but are kept exactly as supplied, including their backslashes.
  const words = line.replace(/\\[a-zA-Z]+/g, 'x').match(/[a-zA-Z]{3,}/g) || [];
  return words.every(word => functions.has(word.toLowerCase()) || (word.length <= 4 && /[,^_0-9]/.test(line))) && !/[`#]/.test(line);
}

function leadingFormula(line) {
  const prose = line.search(/\p{Script=Han}/u);
  if (prose < 0) return { math: line.trim(), tail: '' };
  const prefix = line.slice(0, prose).trimEnd();
  return { math: prefix.trim(), tail: line.slice(prefix.length) };
}

export function normalizeFormulaText(text) {
  if (!text.includes('\n') || /```|\\begin\s*\{|\\[\[(]|\$\$/.test(text)) return text;
  const lines = text.split('\n');
  const parts = lines.map(leadingFormula);
  const output = [];
  for (let i = 0; i < lines.length;) {
    if (!mathLine(parts[i].math)) { output.push(lines[i++]); continue; }
    let end = i + 1;
    while (end < lines.length && !parts[end - 1].tail && mathLine(parts[end].math)) end++;
    const run = lines.slice(i, end), trimmed = parts.slice(i, end).map(part => part.math);
    // A normal sequence of equations or numbered list is left alone. Require
    // short, incomplete fragments and mathematical operators, not just lines.
    const fragments = trimmed.filter(line => line.length <= 6 && !/[=<>≤≥≠≈+*/]/u.test(line));
    const listItems = trimmed.filter(line => /^(?:[-*•]|\d+[.)])\s+\S/.test(line));
    if (run.length >= 3 && fragments.length >= 2 && listItems.length < 2 && mathSymbols.test(trimmed.join(' '))) {
      let joined = trimmed[0];
      for (const line of trimmed.slice(1)) joined += `${relation.test(line) && line.length > 1 ? '\n' : ' '}${line}`;
      output.push(joined + parts[end - 1].tail);
    } else output.push(...run);
    i = end;
  }
  return output.join('\n');
}

function normalizeNode(node) {
  if (node.type === 'codeBlock' || node.marks?.some(mark => mark.type === 'code')) return node;
  const text = typeof node.text === 'string' ? normalizeFormulaText(node.text) : undefined;
  const content = node.content?.map(normalizeNode);
  if (text === node.text && (!content || content.every((child, i) => child === node.content[i]))) return node;
  return { ...node, ...(text === undefined ? {} : { text }), ...(content ? { content } : {}) };
}

// One-time repair of saved notes only. Keep original source text and the full
// previous chapter snapshot; undoing this repair does not reapply it on reload.
export function repairFormulaDocument(document, now = Date.now()) {
  if (document.formulaLayoutVersion >= 1) return document;
  const chapters = document.chapters.map(chapter => {
    const content = normalizeNode(chapter.content);
    return content === chapter.content ? chapter : { ...chapter, content };
  });
  if (chapters.every((chapter, i) => chapter === document.chapters[i])) return document;
  return { ...document, chapters, formulaLayoutVersion: 1, revision: document.revision + 1, updatedAt: now,
    versions: [{ id: crypto.randomUUID(), time: now, label: '修复公式换行之前', chapters: structuredClone(document.chapters) }, ...document.versions].slice(0, 20) };
}
