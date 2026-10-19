import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { parseArgs } from 'node:util';
import { sha256, sourceEvidence } from './lib/source-evidence.mjs';
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const root = resolve('.'), output = resolve(values.out || 'artifacts/product-evidence'), rel = relative(join(root, 'artifacts'), output);
if (!rel || rel.startsWith('..') || resolve(join(root, 'artifacts'), rel) !== output) throw new Error('Output must be under artifacts.');
const evidence = JSON.parse(await readFile('evals/notes/long-use-evidence.json', 'utf8'));
const paths = [...new Set(['evals/notes/long-use-evidence.json', ...evidence.styleAssets, ...evidence.observations.flatMap(item => [...item.coverage, ...(item.humanEvidence ? [item.humanEvidence] : [])])])];
const files = [];
for (const path of paths) { if (!/^(shared|tests|evals)\//.test(path) || path.includes('..')) throw new Error('Invalid evidence reference'); const bytes = await readFile(path); files.push({ path, sha256: sha256(bytes), bytes: bytes.length }); }
await mkdir(output, { recursive: true });
await writeFile(join(output, 'report.json'), JSON.stringify({ schema: 'product-evidence-snapshot-v1', status: 'references-verified', createdAt: new Date().toISOString(), source: await sourceEvidence(root), files, observations: evidence.observations.length, provenance: evidence.provenance, scope: evidence.scope, modelCalls: 0, teachingScore: null, independentTeachingReview: 'pending' }, null, 2) + '\n');
console.log(`Product evidence references verified: ${files.length} files; no teaching score assigned.`);
