import { readdir } from 'node:fs/promises';
import { runNode, root } from './lib/process.mjs';
const files = (await readdir(new URL('../tests/', import.meta.url))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`);
// One browser-heavy test file at a time gives reproducible resource use on CI
// and avoids competing API-server startup deadlines. No tests are skipped.
await runNode(['--test', '--test-concurrency=1', ...files], { cwd: root });
