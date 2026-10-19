import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent } from 'undici';
import { JSDOM } from 'jsdom';
const { createArxivSearch, arxivId } = await import(new URL(`./arxiv.mjs${new URL(import.meta.url).search}`, import.meta.url));

export const sourceId = value => 'S' + createHash('sha256').update(value).digest('hex').slice(0, 22);
const canonicalURL = raw => { const url = new URL(raw); url.hash = ''; return url.href; };
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 || b === 2) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113);
  }
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
    && !(/^2001:/i.test(address) && (parseInt(address.split(':')[1] || '0',16) <= 0x1ff || parseInt(address.split(':')[1],16) === 0xdb8))
    && !/^2002:|^3fff:/i.test(address);
}
export async function safeURL(raw, resolver = lookup) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || raw.length > 3000) throw new Error('研究工具只读取公开 HTTPS 地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /\.(?:local|localhost|internal)$/i.test(host)) throw new Error('不能读取本机或内网地址');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host, { all: true });
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('不能读取本机或内网地址');
  url.hash = ''; return { url: url.href, address: addresses[0] };
}
// DNS is checked and pinned for each redirect: a later resolver result cannot
// turn an allowed URL into an internal request. No cookies/provider key escape.
export async function publicFetch(raw, signal, { resolver = lookup, fetcher = fetch, maxBytes = 12 * 1024 * 1024 } = {}) {
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25000)]);
  for (let redirect = 0; redirect < 5; redirect++) {
    bounded.throwIfAborted();
    const { url, address } = await safeURL(raw, resolver);
    const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
    } } });
    try {
      const response = await fetcher(url, { redirect: 'manual', signal: bounded, dispatcher,
        headers: { 'User-Agent': 'CandlelightNotes/0.1 (personal learning research)', Accept: 'text/html, application/pdf, application/json, text/plain;q=0.8' } });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel(); const location = response.headers.get('location');
        if (!location) throw new Error('来源跳转缺少目标'); raw = new URL(location, url).href; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`来源暂不可读取（${response.status}）`); }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('来源超过研究读取容量'); }
      let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) { throw new Error('来源超过研究读取容量'); } chunks.push(chunk); }
      return { url, bytes: Buffer.concat(chunks), type: (response.headers.get('content-type') || '').split(';')[0] };
    } finally { await dispatcher.close(); }
  }
  throw new Error('来源跳转次数过多');
}
function plainHTML(html) {
  const dom = new JSDOM(html);
  try {
    dom.window.document.querySelectorAll('script,style,nav,header,footer,aside,form,noscript,svg').forEach(e => e.remove());
    const root = dom.window.document.querySelector('main,article,.mw-parser-output') || dom.window.document.body;
    root.querySelectorAll('p,h1,h2,h3,h4,li,br,tr').forEach(e => e.append('\n\n'));
    return { title: dom.window.document.title.trim().slice(0, 300), text: root.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim() };
  } finally { dom.window.close(); }
}
const strip = text => plainHTML(String(text || '')).text;
export function htmlRedirect(html, base) {
  const dom = new JSDOM(html);
  try {
    const content = [...dom.window.document.querySelectorAll('meta[http-equiv]')].find(e => e.getAttribute('http-equiv').toLowerCase() === 'refresh')?.getAttribute('content');
    const target = content?.match(/^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*["']?([^"']+?)["']?\s*$/i)?.[1];
    if (!target) return null;
    const url = new URL(target, base);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('来源跳转不是公开 HTTPS 地址');
    return url.href;
  } finally { dom.window.close(); }
}

export function evidenceExcerpts(source, query) {
  const focused = sourceContext(source, query).replace(/\[正文摘录，字符 \d+ 起\]\n/g, '');
  return focused.split('\n\n').flatMap(part => part.match(/[\s\S]{12,450}/g) || [])
    .map(part => part.trim()).filter(part => part.length >= 12 && source.text.includes(part)).slice(0,16)
    .map((quote,index) => ({ id: `E${index+1}`, quote }));
}

export function createResearchTools(directory, { read = publicFetch } = {}) {
  const assets = join(directory, 'assets'), cache = new Map();
  async function download(url, signal, visited = new Set()) {
    const key = sourceId(canonicalURL(url));
    if (cache.has(key) && Date.now() - cache.get(key).checkedAt < 86400000) return structuredClone(cache.get(key));
    if (visited.has(canonicalURL(url)) || visited.size >= 5) throw new Error('来源跳转循环或次数过多');
    visited.add(canonicalURL(url)); signal?.throwIfAborted();
    const parsedURL = new URL(url);
    const arxivAbstract = /^(?:www\.|export\.)?arxiv\.org$/i.test(parsedURL.hostname) && /^\/abs\/[\w.\/-]+$/.test(parsedURL.pathname);
    if (arxivAbstract) {
      try {
        const full = await download(`https://arxiv.org/pdf/${parsedURL.pathname.slice(5)}`,signal,new Set(visited));
        cache.set(key,full); return full;
      } catch { signal?.throwIfAborted(); /* Keep the real abstract if full text is unavailable. */ }
    }
    const response = await read(url, signal), pdf = response.type === 'application/pdf' || response.bytes.subarray(0, 5).toString() === '%PDF-';
    let text, title, filename, bytes;
    if (pdf) {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: new Uint8Array(response.bytes), useSystemFonts: true, isEvalSupported: false });
      try {
        const document = await task.promise;
        if (document.numPages > 1000) throw new Error('这份来源页数超过导入范围');
        const pages = [...new Set([...Array.from({ length: Math.min(8, document.numPages) }, (_, i) => i + 1), ...Array.from({ length: 8 }, (_, i) => Math.max(1, Math.round(document.numPages * (i + 1) / 8)))])];
        const parts = [];
        for (const number of pages.sort((a,b) => a-b)) {
          signal?.throwIfAborted(); const page = await document.getPage(number), content = await page.getTextContent();
          parts.push(`[p.${number}]\n` + content.items.map(i => i.str || '').join(' ').slice(0, 4500));
        }
        text = parts.join('\n\n');
        if (text.length < 120) throw new Error('这份 PDF 需要 OCR，尚不能核实正文');
        const metadata = await document.getMetadata().catch(() => ({})); title = metadata.info?.Title || decodeURIComponent(new URL(url).pathname.split('/').pop()) || '研究资料';
      } finally { await task.destroy(); }
      bytes = response.bytes; filename = sourceId(bytes) + '.pdf';
    } else if (['text/html', 'application/xhtml+xml'].includes(response.type)) {
      const redirect = htmlRedirect(response.bytes.toString('utf8'), response.url);
      if (redirect) { const source = await download(redirect,signal,visited); cache.set(key,source); return source; }
      const parsed = plainHTML(response.bytes.toString('utf8')); text = parsed.text; title = parsed.title || new URL(url).hostname;
      if (text.length < 180 || /^(?:Just a moment|Access Denied|Verify you are human|Robot Check)/i.test(title)) throw new Error('来源正文不可读或需要登录');
      bytes = Buffer.from(`${title}\n来源：${response.url}\n访问日期：${new Date().toISOString().slice(0,10)}\n\n${text}`); filename = sourceId(bytes) + '.txt';
    } else if (response.type === 'text/plain') {
      text = response.bytes.toString('utf8'); title = decodeURIComponent(new URL(url).pathname.split('/').pop()) || '公开文本';
      bytes = Buffer.from(`来源：${response.url}\n\n${text}`); filename = sourceId(bytes) + '.txt';
    } else throw new Error('来源未返回可读取的网页、文本或 PDF');
    if (text.length < 120 || text.length > 2000000) throw new Error('来源正文长度不适合当前导入');
    await mkdir(assets, { recursive: true }); await writeFile(join(assets, filename), bytes);
    const source = { id: sourceId(canonicalURL(response.url)), title: title.slice(0, 300), url: response.url, level: arxivAbstract && !pdf ? 'abstract' : 'body', text: text.slice(0, 200000),
      extent: pdf ? 'PDF 抽样页面' : arxivAbstract ? 'arXiv 摘要页，全文暂不可读' : text.length > 200000 ? '网页正文前 200000 字符' : '网页正文', ...(arxivAbstract && !pdf ? {} : { asset:filename }), digest: createHash('sha256').update(bytes).digest('hex'), checkedAt: Date.now() };
    cache.set(key, source); return structuredClone(source);
  }
  async function search(query, signal) {
    const key = `query:${query}`;
    if (cache.has(key) && Date.now() - cache.get(key).checkedAt < 86400000) return structuredClone(cache.get(key));
    const results = [], problems = [];
    const calls = await Promise.allSettled([
      read(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=4`, signal),
      read(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=2`, signal),
    ]);
    if (calls[0].status === 'fulfilled') {
      try { const data = JSON.parse(calls[0].value.bytes.toString());
        for (const item of data.message?.items || []) {
          const url = `https://doi.org/${item.DOI}`, abstract = strip(item.abstract);
          results.push({ id: sourceId(url), title: strip(item.title?.[0] || item.DOI).slice(0, 300), url,
            level: abstract.length >= 120 ? 'abstract' : 'metadata', text: abstract.slice(0, 16000), extent: 'Crossref 登记摘要', checkedAt: Date.now() });
        }
      } catch { problems.push('Crossref 返回格式异常'); }
    } else problems.push('论文检索暂不可用');
    if (calls[1].status === 'fulfilled') {
      try {
        const data = JSON.parse(calls[1].value.bytes.toString());
        for (const page of data.pages || []) {
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`;
          try { results.push({ ...await download(url, signal), attribution: 'Wikipedia contributors · CC BY-SA，保留来源链接' }); }
          catch { results.push({ id: sourceId(url), title: page.title, url, level: 'metadata', text: '', extent: '仅检索到题名', checkedAt: Date.now() }); }
        }
      } catch { problems.push('背景资料检索返回格式异常'); }
    } else problems.push('背景资料检索暂不可用');
    signal?.throwIfAborted();
    const result = { sources: results, problems, checkedAt:Date.now() }; if (!problems.length && results.length) cache.set(key, result); return structuredClone(result);
  }
  const arxiv = createArxivSearch(read, sourceId);
  return { search, arxiv, read: download, paper: async (source,signal) => {
    const id=arxivId(source.arxivId || source.url || '');
    if (!id) throw new Error('这份来源没有有效的 arXiv 编号');
    const full=await download(`https://arxiv.org/pdf/${id}`,signal);
    if(!full.asset?.endsWith('.pdf') || arxivId(full.url)?.replace(/v\d+$/,'') !== id.replace(/v\d+$/,'')) throw new Error('arXiv 暂未返回这篇论文的 PDF，请稍后重试。');
    return {...full,title:source.title,arxivId:id,attribution:source.attribution};
  }, asset: async source => {
    if (!source.asset || !/^S[a-f0-9]{22}\.(pdf|txt)$/.test(source.asset)) throw new Error('这份来源尚无可导入正文');
    const data = await readFile(join(assets, source.asset));
    return { filename: `${source.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120)}.${source.asset.endsWith('.pdf') ? 'pdf' : 'txt'}`, data: data.toString('base64'), url: source.url };
  } };
}

export function localSources(input) {
  return input.library.map(d => ({ id: sourceId('local:' + d.id), documentId: d.id, title: d.title, level: 'local',
    text: d.excerpts.map(e => `[p.${e.page}]\n${e.text}`).join('\n\n'), extent: '本机资料抽样页面', checkedAt: Date.now() }));
}

// Select actual relevant windows from a long source; slicing the introduction
// systematically hides reference entries (e.g. sum/len near a manual's end).
export function sourceContext(source, query, maximum = 7000) {
  if (source.text.length <= maximum) return source.text;
  const stop = new Set(['the','and','for','with','from','into','this','that','what','how','documentation','tutorial','introduction','beginner']);
  const terms = [...new Set(query.toLowerCase().match(/[a-z][a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) || [])].filter(t => !stop.has(t));
  const chunks = [];
  const matches = (text, term) => /^[a-z]/.test(term) ? new RegExp(`\\b${term}\\b`, 'i').test(text) : text.includes(term);
  for (let start = 0; start < source.text.length; start += 1400) {
    const text = source.text.slice(start,start+1600), lower = text.toLowerCase();
    chunks.push({ start,text,terms:terms.filter(term => matches(lower,term)),definitions:terms.filter(term => /^[a-z]/.test(term) && new RegExp(`(?:^|\\n)\\s*${term}\\s*\\(`,'m').test(lower)).length,score:0 });
  }
  const frequencies = new Map(terms.map(term => [term,chunks.filter(c => c.terms.includes(term)).length]));
  for (const chunk of chunks) chunk.score = chunk.definitions * 6 + chunk.terms.reduce((n,term) => n + 1 / Math.log2(2 + frequencies.get(term)),0);
  const chosen = chunks.sort((a,b) => b.score-a.score || a.start-b.start).slice(0,4).sort((a,b) => a.start-b.start);
  return chosen.map(c => `[正文摘录，字符 ${c.start} 起]\n${c.text}`).join('\n\n').slice(0,maximum);
}
