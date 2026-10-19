import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { defaultModelConnection, defaultStartupMode } from '../shared/app-settings.mjs';

const singleLine=z.string().refine(value=>!/[\r\n\0]/.test(value),'必须是单行内容');
export const connectionPatchSchema=z.object({
  baseUrl:singleLine.pipe(z.url()).refine(value=>{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash;}).optional(),
  model:singleLine.pipe(z.string().trim().min(1).max(120)).optional(),
  apiKey:singleLine.pipe(z.string().max(1000)).optional(),
}).strict();
export const settingsPatchSchema=connectionPatchSchema.extend({startupMode:z.enum(['manual','translation','adaptive']).optional()}).refine(value=>Object.keys(value).length>0);
const names={baseUrl:'DEEPSEEK_BASE_URL',model:'DEEPSEEK_MODEL',apiKey:'DEEPSEEK_API_KEY',startupMode:'READING_TREE_STARTUP_MODE'};
const owned=new Set(Object.values(names));
export const settingsPath=()=>resolve(process.env.READING_TREE_ENV_FILE||'.env');

async function readEnv(path) {
  try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return '';throw error;}
}
function quote(value) {
  // Node dotenv does not use JSON string escaping. Verify the actual parser
  // round-trip rather than silently changing a key containing # or quotes.
  for(const representation of [`"${value}"`,`'${value}'`,value]) if(parseEnv(`VALUE=${representation}`).VALUE===value)return representation;
  throw new Error('设置中包含无法保存到 .env 的字符。');
}
export function updateEnvText(text,settings) {
  const newline=text.includes('\r\n')?'\r\n':'\n',lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),kept=[];
  for(let index=0;index<lines.length;index++) {
    const line=lines[index],match=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/.exec(line);
    const record=[line];
    // Consume quoted multiline values, including unrelated variables whose
    // contents happen to look like a DEEPSEEK_* assignment.
    if(match&&/^["'`]/.test(match[2])) {
      const delimiter=match[2][0];
      if(!match[2].slice(1).includes(delimiter)) while(index+1<lines.length){const next=lines[++index];record.push(next);if(next.includes(delimiter))break;}
    }
    if(!match||!owned.has(match[1]))kept.push(...record);
  }
  while(kept.at(-1)==='')kept.pop();
  const assignments=Object.entries(names).map(([key,name])=>`${name}=${quote(settings[key])}`);
  const result=[...kept,...(kept.length?['']:[]),...assignments,''].join(newline);
  const decoded=parseEnv(result);
  if(Object.entries(names).some(([key,name])=>decoded[name]!==settings[key]))throw new Error('本机 .env 格式无法安全更新，请先检查未闭合的引号。');
  return result;
}

export async function openSettingsStore({path=settingsPath(),environment=process.env,write=atomicWrite}={}) {
  const text=await readEnv(path),saved=parseEnv(text);
  // Saved UI choices win over stale inherited variables on the next startup,
  // including an explicitly cleared key. Unowned env settings are untouched.
  const values={};for(const [key,name] of Object.entries(names))values[key]=saved[name]??environment[name];
  let current={...defaultModelConnection,startupMode:defaultStartupMode,...Object.fromEntries(Object.entries(values).filter(([,v])=>v!==undefined))};
  try {current={...current,...settingsPatchSchema.parse(current)};}catch{throw new Error('本机 .env 中的模型或阅读启动设置无效，请检查对应字段。');}
  let pending=Promise.resolve();
  const save=patch=>{
    const parsed=settingsPatchSchema.parse(patch);
    const operation=pending.then(async()=>{
      const next={...current,...parsed};
      try {await write(path,updateEnvText(await readEnv(path),next));}
      catch(error){throw new Error(error.message.startsWith('设置中')||error.message.startsWith('本机 .env')?error.message:'无法写入本机 .env，设置未更改。请检查文件权限。');}
      current=next;return publicConfig();
    });
    pending=operation.catch(()=>{});return operation;
  };
  const publicConfig=()=>({baseUrl:current.baseUrl,model:current.model,configured:!!current.apiKey,startupMode:current.startupMode,storage:'env'});
  return {get current(){return {...current};},publicConfig,save,reset:()=>save({...defaultModelConnection})};
}
async function atomicWrite(path,text) {
  const temporary=`${path}.${randomUUID()}.tmp`;
  try {await writeFile(temporary,text,{encoding:'utf8',mode:0o600,flag:'wx'});await rename(temporary,path);}
  finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
