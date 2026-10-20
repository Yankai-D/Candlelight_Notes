export function mathText(node) {
  if (node.type === 'math' || node.type?.name === 'math') return node.attrs.display ? `\\[${node.attrs.latex}\\]` : `\\(${node.attrs.latex}\\)`;
  return '';
}

// Explicit delimiters only: currency and ordinary prose must remain text.
export function parseMath(text, marks, { strict = false, source = false } = {}) {
  const output = [];
  const plain = text => { if (text) output.push({ type: 'text', text, ...(marks?.length ? { marks } : {}) }); };
  let end = 0, i = 0;
  const fail = (expected = 'paired math delimiters') => {
    throw Object.assign(new Error('公式定界符不完整；请使用配对的 \\(…\\) 或 \\[…\\]，并检查 JSON 反斜杠转义。'), {
      issues: [{ code: 'math_delimiter', path: [], offset: i, expected,
        message: `Unmatched math syntax at character ${i}; expected ${expected}.`,
        context: text.slice(Math.max(0, i - 40), i + 100) }],
    });
  };
  while (i < text.length) {
    const rest = text.slice(i);
    // Code stays literal. Only an explicitly math/latex/tex-labelled fence is
    // converted; never unescape backslashes throughout a string or an equation.
    if (i === 0 || text[i - 1] === '\n') {
      const fence = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n/.exec(rest);
      if (fence) {
        const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*(?:\\n|$)`, 'm').exec(rest.slice(fence[0].length));
        const finish = closing ? i + fence[0].length + closing.index + closing[0].length : text.length;
        if (/^(math|latex|tex)$/i.test(fence[2].trim())) {
          if (!closing) { if (strict) fail(fence[1]); i = finish; continue; }
          let latex = rest.slice(fence[0].length, fence[0].length + closing.index).trim();
          const wrapped = /^(?:\$\$([\s\S]*)\$\$|\\\[([\s\S]*)\\\]|\\\(([\s\S]*)\\\))$/.exec(latex);
          if (wrapped) latex = wrapped[1] ?? wrapped[2] ?? wrapped[3];
          plain(text.slice(end, i)); output.push({ type: 'math', attrs: { latex: latex.trim(), display: true } });
          // Keep the fence's line boundary for the surrounding Markdown.
          end = finish - (text[finish - 1] === '\n' ? 1 : 0);
        }
        i = finish; continue;
      }
    }
    if (text[i] === '`') {
      const ticks = /^`+/.exec(rest)[0];
      const close = text.indexOf(ticks, i + ticks.length);
      i = close < 0 ? i + ticks.length : close + ticks.length; continue;
    }
    // MediaWiki's text extraction retains self-contained TeX groups without
    // Markdown delimiters. Recognize only this explicit source convention,
    // with balanced braces; do not guess or repair a truncated quotation.
    // Model output remains subject to the normal delimiter contract.
    if (source && /^\{\\(?:textstyle|displaystyle)\b/.test(rest)) {
      let depth = 0, close = -1;
      for (let at = i; at < text.length; at++) {
        if (text[at] === '\\') { at++; continue; }
        if (text[at] === '{') depth++;
        if (text[at] === '}' && --depth === 0) { close = at; break; }
      }
      if (close >= 0) {
        plain(text.slice(end, i));
        const startOfLine = text.lastIndexOf('\n', i - 1) + 1;
        const nextLine = text.indexOf('\n', close + 1);
        const display = !text.slice(startOfLine, i).trim() && !text.slice(close + 1, nextLine < 0 ? text.length : nextLine).trim();
        output.push({ type: 'math', attrs: { latex: text.slice(i, close + 1), display } });
        i = end = close + 1; continue;
      }
    }
    // Accept one extra escape level on paired delimiters only. The body,
    // especially aligned/matrix \\ row separators, remains byte-for-byte intact.
    // An embedded dollar in an identifier/member-access expression is literal,
    // e.g. frame$column, result()$value, or frame[1]$value. It cannot open math
    // and must not pair with a later dollar across prose or explicit formulas.
    if (text[i] === '$' && /[A-Za-z0-9_.\])]/.test(text[i - 1] || '')
      && /[A-Za-z_.]/.test(text[i + 1] || '')) { i++; continue; }
    const delimiter = /^(\\{1,2})([([])/.exec(rest);
    const dollars = !delimiter && rest.startsWith('$$') ? '$$' : !delimiter && rest[0] === '$' ? '$' : null;
    if (delimiter || dollars) {
      const opening = delimiter?.[0] || dollars;
      const closing = delimiter ? delimiter[1] + (delimiter[2] === '(' ? ')' : ']') : dollars;
      let close = text.indexOf(closing, i + opening.length);
      while (close >= 0 && text[close - 1] === '\\') close = text.indexOf(closing, close + closing.length);
      const single = dollars === '$';
      if (single && close >= 0) {
        const value = text.slice(i + 1, close);
        // Do not turn prices such as "$20 and $30" into an equation.
        if (!value || /\n|^\s|\s$/.test(value) || /\d/.test(text[close + 1] || '') || (/\p{Script=Han}/u.test(value) && !/\\(?:text|mathrm)\{/.test(value))) { i++; continue; }
      }
      if (close < 0) {
        if (strict && (!single || /^\$[a-zA-Z](?=$|[\s_^=+*/-])|^\$\\|^\$[a-zA-Z\\][^\n]*(?:[_^=]|\\[a-zA-Z])/.test(rest))) fail(closing);
        i += opening.length; continue;
      }
      plain(text.slice(end, i));
      output.push({ type: 'math', attrs: { latex: text.slice(i + opening.length, close).trim(), display: delimiter ? delimiter[2] === '[' : dollars === '$$' } });
      i = end = close + closing.length; continue;
    }
    if (strict && /^\\{1,2}[)\]]/.test(rest)) fail();
    if (strict && /^\\(?:begin|end|frac|dfrac|tfrac|sqrt|sum|prod|int|lim|alpha|beta|theta|epsilon|hat|mathbf|mathbb|left|right)\b/.test(rest)) fail();
    if (text[i] === '\\') { i += 2; continue; }
    i++;
  }
  plain(text.slice(end));
  return output;
}

export function mathifyNode(node) {
  if (node.type === 'codeBlock' || node.type === 'math') return node;
  if (!node.content) return node;
  const content = node.content.flatMap(child => {
    if (child.type !== 'text' || child.marks?.some(m => m.type === 'code')) return [mathifyNode(child)];
    const parsed = parseMath(child.text, child.marks);
    return parsed.some(part => part.type === 'math') ? parsed : [child];
  });
  return JSON.stringify(content) === JSON.stringify(node.content) ? node : { ...node, content };
}
