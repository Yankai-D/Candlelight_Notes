import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startTestServer(overrides = {}, {envText, entry = 'server/index.mjs'} = {}) {
  const temporaryRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'pangzhu-test-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await mkdir(join(directory, 'library')); await mkdir(join(directory, 'ideal'));
  if(envText!==undefined)await writeFile(join(directory,'.env'),envText,{mode:0o600});
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|localappdata|userprofile|home|lang|display|xdg_runtime_dir|programfiles|programfiles\(x86\)|reading_tree_pdf_browser|reading_tree_pdf_font)$/i.test(key)));
  const child = spawn(process.execPath, [entry], { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'],
    env: { ...env, DEEPSEEK_API_KEY:'', DEEPSEEK_BASE_URL:'http://127.0.0.1:1', DEEPSEEK_MODEL:'test-only',
      READING_TREE_LIBRARY_DIR:join(directory,'library'), READING_TREE_IDEAL_DIR:join(directory,'ideal'),
      READING_TREE_FILE_STORAGE:'0', READING_TREE_STORAGE_PROFILE_DIR:join(directory,'profile'), READING_TREE_STORAGE_DIR:join(directory,'documents'),
      ...overrides, READING_TREE_ENV_FILE:join(directory,'.env'), PORT:'0' } });
  let logs='';
  child.stdout.on('data',chunk=>{logs=(logs+chunk).slice(-6000)});child.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-6000)});
  async function stop() {
    if(child.pid && child.exitCode===null && child.signalCode===null) {
      const exited=once(child,'exit');child.kill();
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    // Only remove the exact temporary directory created above.
    if(dirname(resolve(directory)) !== temporaryRoot || !directory.includes('pangzhu-test-')) throw new Error('Unexpected test directory');
    await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
  try {
    const base=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>done(new Error(`Test server startup timed out. ${logs}`)),30000);
      const onData=chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match)done(null,match[0]);};
      const onError=error=>done(error),onExit=code=>done(new Error(`Test server exited (${code}). ${logs}`));
      function done(error,value){clearTimeout(timer);child.stdout.off('data',onData);child.off('error',onError);child.off('exit',onExit);error?reject(error):resolve(value);}
      child.stdout.on('data',onData);child.once('error',onError);child.once('exit',onExit);
    });
    return {base,directory,stop};
  } catch(error) { await stop();throw error; }
}
