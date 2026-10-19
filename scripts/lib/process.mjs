import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../', import.meta.url));

export async function runNode(args, { log, env = process.env, cwd = root } = {}) {
  const output = log ? createWriteStream(log) : null;
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const relay = stream => chunk => { stream.write(chunk); output?.write(chunk); };
  child.stdout.on('data', relay(process.stdout)); child.stderr.on('data', relay(process.stderr));
  const cancel = () => child.kill();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${args[0]} failed (${signal || code})`)));
    });
  } finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    if (output) { output.end(); await finished(output); }
  }
}
