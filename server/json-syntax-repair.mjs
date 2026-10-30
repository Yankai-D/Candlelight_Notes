// A conservative JSON grammar repair, not a permissive content decoder.
// Never changes string values, numeric tokens, booleans or null; never fills
// values or closes truncated containers. Only structural punctuation can move.
// Every proposed result must still pass the caller's ORIGINAL validator.
export function repairJSONSyntax(raw) {
  if (typeof raw !== 'string') return null;
  try { JSON.parse(raw); return null; } catch { /* inspect the malformed wire */ }
  let at=0,depth=0;const edits=[];
  const stop=()=>{throw new Error('Ambiguous or unsupported JSON syntax');};
  const space=()=>{while(/[\t\r\n ]/.test(raw[at]||'\0'))at++;};
  const edit=(offset,before,after,reason)=>edits.push({offset,before,after,reason});
  function string() {
    const start=at;if(raw[at++]!=='"')stop();
    for(;at<raw.length;at++){
      if(raw[at]==='"'){
        at++;const token=raw.slice(start,at);JSON.parse(token);return token;
      }
      if(raw[at]==='\\')at++; // JSON.parse checks all escapes, including unicode.
    }
    stop(); // No guessing where a string should end.
  }
  function key() {
    if(raw[at]==='"')return JSON.parse(string());
    // Only an already present identifier directly followed by colon, or a
    // closing quote and colon, may be enclosed. No source-specific key names.
    const start=at,match=/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(raw.slice(at));
    if(!match)stop();at+=match[0].length;
    const closing=raw[at]==='"';if(closing)at++;
    space();if(raw[at]!==':')stop();
    edit(start,'','"','property-opening-quote');
    if(!closing)edit(start+match[0].length,'','"','property-closing-quote');
    return match[0];
  }
  function value() {
    space();if(++depth>256)stop();
    const char=raw[at];
    if(char==='"')string();
    else if(char==='{'||char==='['){
      const object=char==='{',end=object?'}':']',keys=new Set();at++;space();
      if(raw[at]===end){at++;depth--;return;}
      for(;;){
        space();
        if(object){
          const name=key();if(keys.has(name))stop();keys.add(name);
          space();if(raw[at]!==':')stop();at++;
        }
        value();space();
        if(raw[at]===end){at++;break;}
        if(raw[at]===','){
          const comma=at++;space();
          if(raw[at]===end){edit(comma,',','','trailing-comma');at++;break;}
        }else if(object&&raw[at]==='"'){
          // A complete member followed by a quoted member is a missing comma.
          // Array scalar boundaries and unquoted adjacency remain ambiguous.
          edit(at,'',',','member-separator');
        }else stop();
      }
    }else{
      const token=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(at));
      if(!token)stop();at+=token[0].length;
    }
    depth--;
  }
  try {
    value();space();if(at!==raw.length||!edits.length)return null;
    let repaired=raw;
    for(const e of [...edits].sort((a,b)=>b.offset-a.offset))repaired=repaired.slice(0,e.offset)+e.after+repaired.slice(e.offset+e.before.length);
    JSON.parse(repaired);
    return {raw:repaired,edits,protocol:'json-syntax-v1'};
  }catch{return null;}
}
