import { existsSync, openSync, closeSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, open } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root,'data'), stateFile = join(data,'service.json'), lockFile = join(data,'start.lock');
const port = 5186, url = `http://127.0.0.1:${port}`;
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--stop','--no-browser'].includes(arg))) throw new Error('Unknown launcher option');

function browserPath() {
  const paths = [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean)
    .flatMap(base => ['Microsoft/Edge/Application/msedge.exe','Google/Chrome/Application/chrome.exe'].map(file=>join(base,file)));
  const browser = paths.find(existsSync);
  if (!browser) throw new Error('请先安装 Microsoft Edge 或 Google Chrome，再启动烛光笔记。');
  return browser;
}
async function state() { try { return JSON.parse(await readFile(stateFile,'utf8')); } catch { return null; } }
async function config() {
  try { const response = await fetch(`${url}/api/config`,{signal:AbortSignal.timeout(1500)});return response.ok?await response.json():null; }
  catch { return null; }
}
function sameService(saved,current) {
  return saved?.root===root && saved?.port===port && Number.isSafeInteger(saved?.pid) && saved.pid>0
    && typeof saved?.token==='string' && saved.token.length>=32 && saved.token===current?.token;
}
function openApp(browser) {
  const child=spawn(browser,[`--user-data-dir=${join(data,'browser')}`,`--app=${url}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking'],
    {detached:true,stdio:'ignore'});
  child.on('error',error=>{console.error(`无法打开浏览器：${error.message}`);process.exitCode=1;});child.unref();
}
async function available() {
  await new Promise((resolvePromise,reject)=>{
    const probe=createServer();probe.once('error',()=>reject(new Error(`端口 ${port} 被其他程序占用。请关闭占用该端口的程序后再启动；不会连接其他服务或切换到另一个笔记库。`)));
    probe.listen(port,'127.0.0.1',()=>probe.close(resolvePromise));
  });
}
async function main() {
  const saved=await state(),current=await config();
  if(args.has('--stop')) {
    if(sameService(saved,current)) {
      process.kill(saved.pid,'SIGTERM');
      for(let i=0;i<50;i++){if(!sameService(saved,await config()))break;await delay(100);}
      if(sameService(saved,await config()))throw new Error('服务尚未停止，请稍后重试。');
      await unlink(stateFile).catch(()=>{});console.log('烛光笔记服务已停止，笔记和设置保留。');
    } else console.log('此资料包没有正在运行的服务；未停止其他进程。');
    return;
  }
  const browser=browserPath();
  if(sameService(saved,current)){if(!args.has('--no-browser'))openApp(browser);console.log(`已打开 ${url}`);return;}
  await mkdir(data,{recursive:true});
  let lock;
  try{lock=await open(lockFile,'wx');}
  catch(error){if(error.code==='EEXIST')throw new Error('烛光笔记正在启动。若上次启动意外退出，请确认没有启动进程后删除 data/start.lock 再试。');throw error;}
  let child;
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    await available();
    await writeFile(join(data,'.env'),'DEEPSEEK_API_KEY=\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=deepseek-flash\nREADING_TREE_STARTUP_MODE=adaptive\n',{flag:'wx'})
      .catch(error=>{if(error.code!=='EEXIST')throw error;});
    await mkdir(join(data,'logs'),{recursive:true});
    const out=openSync(join(data,'logs/server.log'),'a'),err=openSync(join(data,'logs/server-error.log'),'a');
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|windir|temp|tmp|localappdata|appdata|userprofile|programfiles|programfiles\(x86\)|programdata|lang)$/i.test(key)));
    Object.assign(env,{PORT:String(port),READING_TREE_ENV_FILE:join(data,'.env'),READING_TREE_LIBRARY_DIR:join(root,'materials'),
      READING_TREE_IDEAL_DIR:join(data,'ideal-trees'),READING_TREE_PDF_BROWSER:browser});
    try{child=spawn(process.execPath,[join(root,'app/server/index.mjs')],{cwd:join(root,'app'),env,detached:true,windowsHide:true,stdio:['ignore',out,err]});}
    finally{closeSync(out);closeSync(err);}
    let spawnError;child.on('error',error=>{spawnError=error;});child.unref();
    let ready;
    for(let i=0;i<120;i++) {
      if(spawnError||child.exitCode!==null)throw new Error('服务启动失败，请查看 data/logs/server-error.log。');
      ready=await config();if(ready?.token)break;await delay(250);
    }
    if(!ready?.token)throw new Error('启动超时，请查看 data/logs/server-error.log 后重试。');
    await writeFile(stateFile,JSON.stringify({root,pid:child.pid,port,token:ready.token},null,2));
    if(!args.has('--no-browser'))openApp(browser);
    console.log(`烛光笔记已启动：${url}`);
  } catch(error){if(child?.pid)child.kill('SIGTERM');throw error;}
  finally{await lock.close();await unlink(lockFile).catch(()=>{});}
}
await main().catch(error=>{console.error(error.message);process.exitCode=1;});
