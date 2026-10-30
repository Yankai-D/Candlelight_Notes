// Inventory, not automatic correction. A model must explicitly identify which
// unpaired backslashes represent literal text. For example, a valid JSON \t
// may be a tab OR the start of an under-escaped command. Never guess globally.
export function jsonStringEscapes(raw) {
  if(typeof raw!=='string')return [];
  let quoted=false;const found=new Map();
  for(let at=0;at<raw.length;at++){
    if(raw[at]==='"'){quoted=!quoted;continue;}
    if(!quoted||raw[at]!=='\\')continue;
    const next=raw[at+1];
    if(!next)break;
    if(['\\','"','/'].includes(next)){at++;continue;}
    if(next==='u'&&/^[0-9a-fA-F]{4}$/.test(raw.slice(at+2,at+6))){at+=5;continue;}
    const match=/^\\(?:[A-Za-z]+|[^A-Za-z0-9_\s"\\])/.exec(raw.slice(at));
    if(match){
      const sequence=match[0],item=found.get(sequence)||{sequence,validJSONPrefix:['b','f','n','r','t'].includes(next),offsets:[]};
      item.offsets.push(at);found.set(sequence,item);
    }
    at++; // The next quote, if any, is escaped and cannot close this string.
  }
  return [...found.values()];
}

export function escapeJSONSequences(raw,sequences) {
  const inventory=jsonStringEscapes(raw),offsets=[];
  if(!Array.isArray(sequences)||!sequences.length||new Set(sequences).size!==sequences.length)throw new Error('Choose distinct literal sequences from the current inventory.');
  for(const sequence of sequences){
    const item=inventory.find(item=>item.sequence===sequence);
    if(!item)throw new Error('Sequence is absent or already JSON-escaped. Inspect the current stringEscapes inventory.');
    offsets.push(...item.offsets);
  }
  let text=raw;
  for(const at of offsets.sort((a,b)=>b-a))text=text.slice(0,at)+'\\'+text.slice(at);
  return text;
}

export function escapeInventory(raw) {
  const all=jsonStringEscapes(raw);
  return {sequences:all.slice(0,32).map(({sequence,validJSONPrefix,offsets})=>({sequence,validJSONPrefix,matches:offsets.length,
    samples:offsets.slice(0,2).map(offset=>({offset,context:raw.slice(Math.max(0,offset-30),offset+sequence.length+30)}))})),
    truncated:all.length>32,policy:'Read-only inventory. Only explicitly selected literal sequences are escaped; valid JSON escapes may be intentional. This operation requires normal content review, not syntax-only acceptance.'};
}
