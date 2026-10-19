import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
if (!isMainThread) {
  try { const { parseMaterial } = await import('./material-import.mjs'); parentPort.postMessage({ result: await parseMaterial(workerData) }); }
  catch (error) { parentPort.postMessage({ error: error.message }); }
}
export function parseMaterialInWorker(input, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let done = false;
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new Error('资料读取已取消。'));
    const timer = setTimeout(() => finish(new Error('资料读取超时，请按章节拆分后导入。')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.result));
    worker.once('error', () => finish(new Error('资料无法解析或结构过于复杂，请重新保存或拆分后导入。')));
    worker.once('exit', () => { if (!done) finish(new Error('资料读取中断，请重试。')); });
    if (signal?.aborted) abort();
  });
}
