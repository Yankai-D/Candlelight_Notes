import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestServer } from '../tests/support/server.mjs';
import { runNode, root } from './lib/process.mjs';
await access(new URL('../dist/index.html', import.meta.url)).catch(()=>{throw new Error('请先运行 npm run build，再执行浏览器验收。');});
await mkdir(join(root,'artifacts/browser'),{recursive:true});
const server=await startTestServer();
try {
  for(const suite of ['onboarding','bundles','nested-bundles','ideal-tree','settings','calibration','field-review']) await runNode([`tests/browser/${suite}.mjs`],{
    env:{...process.env,PANGZHU_TEST_URL:server.base,PANGZHU_TEST_OUTPUT:join(root,'artifacts/browser',suite)},
  });
} finally { await server.stop(); }
await runNode(['tests/browser/file-storage.mjs'], { env: { ...process.env, PANGZHU_TEST_OUTPUT: join(root, 'artifacts/browser/file-storage') } });
await runNode(['tests/browser/batch-import.mjs'], { env: { ...process.env, PANGZHU_TEST_OUTPUT: join(root, 'artifacts/browser/batch-import') } });
await runNode(['tests/browser/ideal-tree-local.mjs'], { env: { ...process.env, PANGZHU_TEST_OUTPUT: join(root, 'artifacts/browser/ideal-tree-local') } });
await runNode(['tests/browser/workspace-maintenance.mjs'], { env: { ...process.env, PANGZHU_TEST_OUTPUT: join(root, 'artifacts/browser/workspace-maintenance') } });
