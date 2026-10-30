import { mkdir, readdir, unlink, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicJSON, readJSON } from './workspace-state.mjs';
import { requestSchema, buildMessages } from './harness.mjs';
import { optionalRecord } from './recovery.mjs';
import { executionBinding } from './execution.mjs';
import { bundlePlanInputSchema } from '../shared/bundle-context.mjs';
import { generationUsage } from '../shared/generation-usage.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const documentId = value => { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value || '')) throw new Error('无效的资料编号。'); return value; };
const recordId = value => { if (!/^[a-f0-9-]{36}$/.test(value || '')) throw new Error('无效的生成记录编号。'); return value; };
const activeRecords = new Set();
async function directory(system, id, create = false) {
  const path = join(system, 'generation-records', documentId(id));
  if (create) await mkdir(path, { recursive: true });
  const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error('生成记录路径被重定向。'); return path;
}
const summary = record => ({ id: record.id, documentId: record.documentId, action: record.request.action, notebookId: record.request.notebookId, chapterId: record.request.chapterId, chapterTitle: record.request.action === 'bundle-plan' ? '整理规划' : record.request.document?.chapters.find(chapter => chapter.id === record.request.chapterId)?.title,
  startedAt: record.startedAt, finishedAt: record.finishedAt, status: record.status, model: record.model, revision: record.request.revision,
  calls: record.calls.length, repairs: record.events.filter(event => event.repair).length,
  inputTokens: record.events.filter(event => Number.isFinite(event.promptTokens)).reduce((total, event) => total + event.promptTokens, 0),
  outputTokens: record.events.filter(event => Number.isFinite(event.completionTokens)).reduce((total, event) => total + event.completionTokens, 0),
  usageReported: record.events.some(event => Number.isFinite(event.completionTokens)), stageUsage: generationUsage(record.events),
  errorCode: record.errorCode, compacted: !!record.compacted });
export async function readGenerationRecords(system, id, selected) {
  const path = await directory(system, id).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!path) return selected ? null : [];
  if (selected) {
    const file = join(path, recordId(selected) + '.json'); if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error('记录路径异常。');
    return readJSON(file);
  }
  const records = [];
  for (const name of await readdir(path)) if (/^[a-f0-9-]{36}\.json$/.test(name)) { const file = join(path, name); if (await realpath(file) !== file) continue; const record = await readJSON(file); records.push(summary(record)); }
  return records.sort((a,b) => b.startedAt - a.startedAt);
}
export async function generationRecordFiles(system, id) {
  const path = await directory(system, id).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!path) return [];
  const files = [];
  for (const name of await readdir(path)) {
    const file = join(path, name), info = await lstat(file);
    if (!/^[a-f0-9-]{36}\.json$/.test(name) || !info.isFile() || info.isSymbolicLink() || await realpath(file) !== file || activeRecords.has(file)) throw new Error('生成记录仍在写入或目录异常，未永久删除。');
    files.push(file);
  }
  return files;
}
export async function createGenerationRecord(system, input, model, fetcher = fetch) {
  const request = input.action === 'bundle-plan' ? bundlePlanInputSchema.parse(input) : requestSchema.parse(input), path = await directory(system, request.documentId, true);
  // Resume only the same task/input. A new regeneration workflow, changed goal,
  // source, revision or model starts fresh. Credentials never enter this key.
  const resumeDigest = hash({ messages: executionBinding(buildMessages(request)), revision: request.revision,
    documentId: request.documentId, notebookId: request.notebookId, workflowId: request.workflow?.id, planningId: request.planningId, reviewPolicy: request.workflow?.reviewPolicy, model });
  let execution, resumedFrom;
  await optionalRecord(async () => {
    const entries = (await readdir(path)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    const recent = [];
    for (const name of entries) {
      const candidate = join(path, name), info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink() || activeRecords.has(candidate) || await realpath(candidate) !== candidate) continue;
      recent.push({ file: candidate, time: info.mtimeMs, size: info.size });
    }
    for (const entry of recent.sort((a,b) => b.time-a.time).slice(0, 20)) {
      if (entry.size > 32 * 1024 * 1024) continue;
      const previous = await readJSON(entry.file);
      if (previous.resumeDigest === resumeDigest) {
        if (previous.execution && !['accepted', 'success'].includes(previous.status)) {
          execution = previous.execution; resumedFrom = previous.id;
        }
        break;
      }
    }
  }, 'execution-checkpoint-read');
  const record = { format: 'candlelight-generation-v1', id: randomUUID(), documentId: request.documentId, model, startedAt: Date.now(), status: 'running', request, requestDigest: hash(request), resumeDigest,
    ...(execution ? { execution, resumedFrom } : {}), calls: [], events: [] };
  const file = join(path, record.id + '.json');
  async function save() {
    if (Buffer.byteLength(JSON.stringify(record)) > 32 * 1024 * 1024) {
      record.compacted = true;
      for (const call of record.calls) { delete call.messages; call.messagesOmitted = true; }
    }
    if (Buffer.byteLength(JSON.stringify(record)) > 32 * 1024 * 1024) throw new Error('生成上下文过大，无法保存追溯记录。');
    await atomicJSON(file, record, {delays:[80,160]});
  }
  await optionalRecord(save, 'generation-record-start');
  activeRecords.add(file);
  const wrapped = async (url, options) => {
    const body = JSON.parse(options.body), call = { startedAt: Date.now(), maxTokens: body.max_tokens, messagesDigest: hash(body.messages), messages: body.messages, status: 'requested' };
    record.calls.push(call); await optionalRecord(save, 'generation-record-call');
    try { const response = await fetcher(url, options); call.status = 'response'; call.httpStatus = response.status; call.elapsedMs = Date.now() - call.startedAt; return response; }
    catch (error) { call.status = 'transport-failed'; call.elapsedMs = Date.now() - call.startedAt; throw error; }
  };
  async function finish(status, result, error) {
    record.status = status; record.finishedAt = Date.now();
    if (result) { record.resultDigest = hash(result); record.resultSummary = String(result.summary || '').slice(0,4000); }
    if (error) record.errorCode = error.name === 'AbortError' ? 'CANCELLED' : String(error.code || 'GENERATION_FAILED').slice(0,100);
    await optionalRecord(save, 'generation-record-finish');
    activeRecords.delete(file);
    // Keep recent evidence bounded without storing any credentials or headers.
    await optionalRecord(async () => {
    const entries = [];
    for (const name of await readdir(path)) if (/^[a-f0-9-]{36}\.json$/.test(name)) { const recordPath = join(path, name); if (await realpath(recordPath) !== recordPath) continue; const info = await lstat(recordPath); entries.push({ path: recordPath, size: info.size, time: info.mtimeMs }); }
    entries.sort((a,b) => b.time - a.time); let total = 0;
    for (const [index, entry] of entries.entries()) { total += entry.size; if ((index >= 20 || total > 64 * 1024 * 1024) && entry.path !== file && !activeRecords.has(entry.path)) await unlink(entry.path); }
    }, 'generation-record-retention');
  }
  return { id: record.id, fetch: wrapped, event: value => record.events.push(value), finish,
    checkpoint: execution, saveCheckpoint: async state => { record.execution = state; await save(); } };
}
