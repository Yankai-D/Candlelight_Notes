import { JSDOM } from 'jsdom';
import { setTimeout as delay } from 'node:timers/promises';

const identifier = /^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+\/\d{7})(?:v\d+)?$/i;
export function arxivId(value) {
  if (identifier.test(value)) return value;
  try {
    const url = new URL(value);
    if (!/^(?:www\.|export\.)?arxiv\.org$/i.test(url.hostname) || !['https:','http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const id = url.pathname.replace(/^\/(?:abs|pdf)\//,'').replace(/\.pdf$/,'');
    return identifier.test(id) ? id : null;
  } catch { return null; }
}
const clean = value => String(value || '').replace(/\s+/g,' ').trim();
function paper(id, title, text, authors = [], published = '') {
  if (!id || !title || text.length < 120) return null;
  return { arxivId:id, title:clean(title).slice(0,300), text:clean(text).slice(0,16000), authors,
    published, url:`https://arxiv.org/abs/${id}`, level:'abstract', extent:'arXiv 官方摘要 · 全文在导入时下载',
    attribution:`${authors.join(', ')}${published ? ` · ${published.slice(0,4)}` : ''} · arXiv`, checkedAt:Date.now() };
}
export function parseArxivFeed(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('arXiv 返回了无效的元数据');
  const dom = new JSDOM(xml,{contentType:'text/xml'});
  try {
    const entries = [...dom.window.document.getElementsByTagNameNS('*','entry')];
    const text = (el,name) => el.getElementsByTagNameNS('*',name)[0]?.textContent || '';
    return entries.map(entry => paper(arxivId(text(entry,'id').trim()),text(entry,'title'),text(entry,'summary'),
      [...entry.getElementsByTagNameNS('*','author')].map(a=>clean(text(a,'name'))),text(entry,'published'))).filter(Boolean);
  } finally { dom.window.close(); }
}
export function parseArxivPage(html, requestedId) {
  const dom = new JSDOM(html);
  try {
    const doc=dom.window.document, meta=name=>doc.querySelector(`meta[name="${name}"]`)?.content || '';
    const id=arxivId(meta('citation_arxiv_id'));
    if (!id || id.replace(/v\d+$/,'') !== requestedId.replace(/v\d+$/,'')) throw new Error('arXiv 页面编号与候选论文不一致');
    return paper(id,meta('citation_title'),doc.querySelector('blockquote.abstract')?.textContent.replace(/^\s*Abstract:\s*/,'') || meta('description'),
      [...doc.querySelectorAll('meta[name="citation_author"]')].map(e=>e.content),meta('citation_date'));
  } finally { dom.window.close(); }
}

// The official API asks for a single connection and >=3 seconds between calls.
// Keep the gate across harness hot reloads; cache successful lookups per process.
const key=Symbol.for('pangzhu.arxivRequests');
const gate=globalThis[key] ||= { tail:Promise.resolve(), next:0 };
async function limited(read,url,signal) {
  const operation=gate.tail.catch(()=>{}).then(async()=>{
    signal?.throwIfAborted();
    if (gate.next>Date.now()) await delay(gate.next-Date.now(),undefined,{signal});
    gate.next=Date.now()+3100;
    return read(url,signal);
  });
  gate.tail=operation; return operation;
}
export function createArxivSearch(read, sourceId) {
  const cache=new Map();
  return async ({query='',ids=[]},signal) => {
    const valid=[...new Set(ids.map(arxivId).filter(Boolean))].slice(0,2);
    const terms=(query.match(/[\p{L}\p{N}_-]+/gu)||[]).slice(0,12);
    const key=JSON.stringify([terms,valid]);
    if(cache.has(key)&&Date.now()-cache.get(key).checkedAt<86400000) return structuredClone(cache.get(key));
    const sources=[],problems=[];
    const collect=items=>items.forEach(item=>{
      const canonical=item.arxivId.replace(/v\d+$/,'');
      if(!sources.some(s=>s.arxivId.replace(/v\d+$/,'')===canonical)) sources.push({...item,id:sourceId(`https://arxiv.org/pdf/${item.arxivId}`)});
    });
    const api=async params=>{
      const result=await limited(read,`https://export.arxiv.org/api/query?${new URLSearchParams(params)}`,signal);
      collect(parseArxivFeed(result.bytes.toString('utf8')));
    };
    // Verify exact candidates first; the query remains useful for unfamiliar
    // topics and for papers whose IDs the model does not know.
    if(valid.length) {
      try { await api({id_list:valid.join(','),max_results:'2'}); }
      catch { signal?.throwIfAborted(); problems.push('arXiv 元数据接口暂不可用，已尝试论文摘要页。'); }
      for(const id of valid) if(!sources.some(s=>s.arxivId.replace(/v\d+$/,'')===id.replace(/v\d+$/,''))) {
        try { const response=await limited(read,`https://arxiv.org/abs/${id}`,signal); const result=parseArxivPage(response.bytes.toString('utf8'),id); if(result) collect([result]); }
        catch { signal?.throwIfAborted(); problems.push(`未能核实 arXiv:${id}`); }
      }
    }
    if(terms.length) {
      try { await api({search_query:terms.map(t=>`all:"${t}"`).join(' AND '),start:'0',max_results:'5',sortBy:'relevance',sortOrder:'descending'}); }
      catch { signal?.throwIfAborted(); problems.push('arXiv 关键词检索暂不可用，可稍后重新查找。'); }
    }
    const result={sources,problems,checkedAt:Date.now()};
    if(sources.length&&!problems.length) cache.set(key,result);
    return result;
  };
}
