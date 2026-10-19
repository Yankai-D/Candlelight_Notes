import { brand } from '../shared/brand.mjs';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requestSchema, runModel, buildMessages, validateResult } from './harness.mjs';
import { readLibrary, readLibrarySource } from './library.mjs';
import { openSettingsStore, settingsPath, connectionPatchSchema } from './settings-store.mjs';
import { idealTreeActivity, pauseIdealTrees } from './ideal-tree/adapter.mjs';
import { FileLibrary } from './file-library.mjs';
import { createGenerationRecord } from './generation-records.mjs';
import { parseMaterialInWorker } from './material-worker.mjs';

const envFile=settingsPath();
try { process.loadEnvFile(envFile); } catch (e) { if (e.code !== 'ENOENT') console.error('无法读取 .env 文件'); }
const dev = process.argv.includes('--dev');
let port = Number(process.env.PORT || 5173);
const token = randomBytes(32).toString('hex');
let workspaceToken = randomBytes(16).toString('hex'), maintaining = false;
const settings=await openSettingsStore({path:envFile});
const files = new FileLibrary({ profile: process.env.READING_TREE_STORAGE_PROFILE_DIR,
  defaultDirectory: process.env.READING_TREE_STORAGE_DIR, programDirectory: process.env.READING_TREE_PROGRAM_DIR,
  builtinDirectory: process.env.READING_TREE_LIBRARY_DIR || '.local-library',
  legacyIdealDirectory: process.env.READING_TREE_IDEAL_DIR || '.local-ideal-trees' });
let fileReady;
async function fileCommand(command) {
  if (!fileReady) fileReady = files.command({ action: 'status' }).then(status => {
    process.env.READING_TREE_IDEAL_DIR = resolve(status.systemDirectory, 'ideal-trees'); return status;
  }).catch(error => { fileReady = null; throw error; });
  await fileReady;
  const result = await files.command(command);
  process.env.READING_TREE_IDEAL_DIR = resolve(files.index.systemDirectory, 'ideal-trees');
  return result;
}
const controllers = new Set();
let desktopPDFRenderer, closing = false;
export const setPDFRenderer = renderer => { desktopPDFRenderer = renderer; };
export const serviceActivity = () => controllers.size + idealTreeActivity();
export async function pauseServiceWork() {
  for (const controller of controllers) controller.abort();
  await pauseIdealTrees();
}
// Keep the schema and its handlers in the same module graph. Query-string hot
// imports refreshed the harness but reused cached shared dependencies, mixing
// incompatible exports after an update. Backend changes require a restart.
const vite = dev ? await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'spa' }) : null;
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req, maximum = 16 * 1024 * 1024) {
  const chunks = []; let size = 0;
  // Decode once: TCP chunks can split a Chinese character or an emoji.
  for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new Error('请求过大，请缩小学习资料范围。'); chunks.push(chunk); }
  return JSON.parse(size ? Buffer.concat(chunks).toString('utf8') : '{}');
}
const server = http.createServer(async (req, res) => {
  if (closing) return send(res, 503, { error: '应用正在退出，请稍后重新打开。' });
  const path = req.url?.split('?')[0];
  if (path?.startsWith('/api/')) {
    if (maintaining && req.method !== 'GET') return send(res, 409, { error: '资料库正在备份或恢复，请等待完成。' });
    const config=settings.current;
    const localOrigin = `http://127.0.0.1:${port}`;
    const origin = req.headers.origin;
    if (origin && ![localOrigin, `http://localhost:${port}`].includes(origin)) return send(res, 403, { error: '来源不被允许。' });
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, { error: '主机不被允许。' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: '来源不被允许。' });
    if (req.method !== 'GET' && req.headers['x-reading-tree-token'] !== token) return send(res, 403, { error: '会话已过期，请刷新页面。' });
    try {
      if (path === '/api/import/material' && req.method === 'POST') {
        const input = z.object({ name: z.string().min(1).max(500), data: z.string().max(72 * 1024 * 1024), workspaceToken: z.string().optional() }).strict().parse(await body(req, 74 * 1024 * 1024));
        if (input.workspaceToken && input.workspaceToken !== workspaceToken) return send(res, 409, { error: '学习空间已切换，请重新打开导入窗口。' });
        const controller = new AbortController(); controllers.add(controller);
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        try { return send(res, 200, await parseMaterialInWorker(input, controller.signal)); }
        finally { controllers.delete(controller); }
      }
      if (path === '/api/storage' && process.env.READING_TREE_FILE_STORAGE !== '0') {
        if (req.headers['x-reading-tree-token'] !== token) return send(res, 403, { error: '会话已过期，请刷新页面。' });
        if (req.method !== 'POST') return send(res, 405, { error: '请使用存储接口。' });
        const input = await body(req, 96 * 1024 * 1024);
        if (maintaining) return send(res, 409, { error: '资料库正在备份或恢复，请等待完成。' });
        if (input.workspaceToken && input.workspaceToken !== workspaceToken) return send(res, 409, { error: '学习空间已切换，请刷新窗口后再操作。当前窗口未覆盖任何文件。' });
        const exclusive = ['workspace-backup', 'workspace-preview', 'workspace-restore', 'workspace-undo', 'retired-purge', 'workspace-move-preview', 'workspace-move'].includes(input.action);
        if (['retire', 'retired-purge'].includes(input.action) && serviceActivity()) return send(res, 409, { error: '请先暂停生成任务，再移除资料。' });
        if (exclusive && serviceActivity()) return send(res, 409, { error: '请先暂停当前生成或学习树任务，再备份或恢复。' });
        let result; const beforeDirectory = files.index?.directory;
        try {
          if (exclusive) maintaining = true;
          result = await fileCommand(input);
        } finally {
          // Even an interrupted two-file commit can complete from its journal
          // on the next command. Old windows must not write into that space.
          if (['workspace-restore', 'workspace-undo'].includes(input.action) || input.action === 'workspace-move' && files.index?.directory !== beforeDirectory) workspaceToken = randomBytes(16).toString('hex');
          if (exclusive) maintaining = false;
        }
        if (input.action === 'file' && result) { res.writeHead(200, { 'Content-Type': result.type, 'Cache-Control': 'no-store' }); res.end(result.data); return; }
        return send(res, 200, result ?? null);
      }
      if (path === '/api/library' && req.method === 'GET') return send(res, 200, await readLibrary());
      if (path.startsWith('/api/library/') && path.endsWith('/source') && req.method === 'GET') {
        const source = await readLibrarySource(path.slice('/api/library/'.length, -'/source'.length));
        if (!source) return send(res, 404, { error: '这份原文不在本机书单中。' });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        res.end(source); return;
      }
      if (path === '/api/export/pdf' && req.method === 'POST') {
        const input = await body(req);
        const document = requestSchema.shape.document.extend({
          entryType: z.literal('note').optional(),
          subtitle: z.string().max(1000).optional(),
          notebookLabel: z.string().max(120).optional(),
          demo: z.boolean().optional(),
        }).parse(input.document);
        const fontSize = z.number().min(12).max(24).default(17).parse(input.fontSize);
        const articleWidth = z.number().min(280).max(1920).default(920).parse(input.articleWidth);
        const viewportWidth = z.number().min(320).max(7680).default(1440).parse(input.viewportWidth);
        const theme = z.enum(['sage', 'dark', 'light']).default('sage').parse(input.theme);
        const { renderLearningPDF } = await import('./pdf-export.mjs');
        const buffer = await (desktopPDFRenderer || renderLearningPDF)(document, { fontSize, articleWidth, viewportWidth, theme });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(document.title.toWellFormed() + '.pdf'), 'Cache-Control': 'no-store' });
        res.end(buffer); return;
      }
      if (path === '/api/config' && req.method === 'GET') return send(res, 200, { ...settings.publicConfig(), token, workspaceToken, fileStorage: process.env.READING_TREE_FILE_STORAGE !== '0' });
      if (path === '/api/organize' && req.method === 'POST') {
        if (!config.apiKey) return send(res, 400, { error: '请先连接模型，再自动整理学习树。' });
        const controller = new AbortController();
        controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), 180000);
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        try {
          const { organizeTree } = await import('./organization-harness.mjs');
          const activeConfig = { ...config };
          const result = await organizeTree(activeConfig, await body(req), controller.signal, fetch, { onDiagnostic: async diagnostic => {
            const directory = process.env.READING_TREE_DIAGNOSTIC_DIR || '.cache';
            await mkdir(directory, { recursive: true });
            await writeFile(resolve(directory, 'organization-last.json'), JSON.stringify(diagnostic, null, 2));
          } });
          return send(res, 200, { result, model: activeConfig.model });
        } finally { clearTimeout(timer); controllers.delete(controller); }
      }
      if (path === '/api/config' && req.method === 'POST') {
        return send(res, 200, await settings.save(await body(req)));
      }
      if(path==='/api/config/reset'&&req.method==='POST')return send(res,200,await settings.reset());
      if (['/api/edit', '/api/test'].includes(path) && req.method === 'POST') {
        const input = await body(req);
        if (input.workspaceToken && input.workspaceToken !== workspaceToken) return send(res, 409, { error: '学习空间已切换，请刷新窗口后再操作。未调用模型。' });
        // Workspace identity is transport metadata. Consume it here so strict
        // tree/template commands receive only their domain fields.
        delete input.workspaceToken;
        if (input?.action === 'ideal-tree' && process.env.READING_TREE_FILE_STORAGE !== '0') await fileCommand({ action: 'status' });
        if (maintaining) return send(res, 409, { error: '资料库正在备份或恢复，请等待完成。' });
        const activeConfig=path==='/api/test'?{...config,...connectionPatchSchema.parse(input)}:{...config};
        const localIdealCommand = input?.action === 'ideal-tree' && ['list', 'get', 'pause', 'export', 'resource', 'delete'].includes(input.command);
        if (!activeConfig.apiKey && !localIdealCommand) return send(res, 400, { error: '请先在模型设置中填写 DeepSeek API Key。' });
        const controller = new AbortController();
        controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), path === '/api/test' ? 45000 : 360000);
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        try {
          if (path === '/api/test') {
            await runModel(activeConfig, [{ role: 'user', content: 'Return JSON: {"ok":true}' }], controller.signal, fetch, { action: 'test' });
            return send(res, 200, { ok: true });
          }
          const generation = [];
          const messages = buildMessages(input);
          let record;
          if (process.env.READING_TREE_FILE_STORAGE !== '0' && input.documentId && ['generate', 'explain', 'rewrite', 'style'].includes(input.action)) {
            await fileCommand({ action: 'status' }); record = await createGenerationRecord(files.index.systemDirectory, input, activeConfig.model);
          }
          try {
            const raw = await runModel(activeConfig, messages, controller.signal, record?.fetch || fetch, { action: input.action, onCompletion: info => { generation.push(info); record?.event(info); } });
            const result = validateResult(input, raw);
            await record?.finish('accepted', result);
            return send(res, 200, { result, model: activeConfig.model, generation, recordId: record?.id });
          } catch (error) { await record?.finish(controller.signal.aborted ? 'cancelled' : 'failed', undefined, error); throw error; }
        } finally { clearTimeout(timer); controllers.delete(controller); }
      }
      return send(res, 404, { error: '接口不存在。' });
    } catch (error) {
      const message = error.name === 'AbortError' ? '请求已取消或超时，笔记未被修改。' : error instanceof z.ZodError ? '输入格式不正确，请检查模型设置或重新选择内容。' : error.message === 'fetch failed' ? '无法连接模型服务，请检查网络与 API 地址。' : error.message;
      if (!res.destroyed) send(res, 400, { error: message });
    }
    return;
  }
  if (path === '/review/course.html' && req.method === 'GET') {
    try {
      const { renderCourseReference } = await import('../scripts/render-course-reference.mjs');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderCourseReference());
    } catch { res.writeHead(500); return res.end('讲义样稿暂时无法打开。'); }
  }
  if (path === '/review/editorial' && req.method === 'GET') {
    try {
      const { renderEditorialReference } = await import('../scripts/render-editorial-reference.mjs');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderEditorialReference());
    } catch { res.writeHead(500); return res.end('文风样稿暂时无法打开。'); }
  }
  if (vite) return vite.middlewares(req, res);
  try {
    const root = resolve(process.env.READING_TREE_STATIC_DIR || 'dist');
    const requested = resolve(root, '.' + decodeURIComponent(path || '/'));
    if (!requested.startsWith(root + '\\') && !requested.startsWith(root + '/') && requested !== root) { res.writeHead(403); return res.end(); }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mjs': 'text/javascript' };
    let file = requested;
    let data;
    try { data = await readFile(file); } catch { file = resolve(root, 'index.html'); data = await readFile(file); }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(500); res.end('请先运行 npm run build'); }
});
export const serviceReady = new Promise((resolveReady, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => {
    port = server.address().port;
    const address = `http://127.0.0.1:${port}`;
    console.log(`${brand.name}已启动：${address}`);
    resolveReady(address);
  });
});
let shutdown;
export function shutdownService() {
  return shutdown ||= (async () => {
    closing = true;
    await pauseServiceWork();
    await files.pending;
    await vite?.close();
    await new Promise(resolveClose => {
      const timer = setTimeout(() => server.closeAllConnections(), 5000);
      server.close(() => { clearTimeout(timer); resolveClose(); });
      server.closeIdleConnections();
    });
  })();
}
if (!process.env.READING_TREE_DESKTOP) {
  serviceReady.catch(error => { console.error(error.message); process.exitCode = 1; });
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => { void shutdownService().finally(() => process.exit(0)); });
}
