import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sourceEvidence } from '../scripts/lib/source-evidence.mjs';

test('verification fingerprint detects uncommitted, untracked and deleted source but excludes ignored private state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'candlelight-evidence-'));
  const git = args => execFileSync('git', args, { cwd: directory, windowsHide: true, stdio: 'pipe' });
  try {
    git(['init']); await writeFile(join(directory, '.gitignore'), '.env\n');
    await writeFile(join(directory, 'package-lock.json'), '{}'); await writeFile(join(directory, 'source.mjs'), 'original');
    git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
    const original = await sourceEvidence(directory); assert.equal(original.status, '');
    await writeFile(join(directory, '.env'), 'TEST_ONLY_PRIVATE');
    assert.deepEqual(await sourceEvidence(directory), original);
    await writeFile(join(directory, 'source.mjs'), 'changed');
    const changed = await sourceEvidence(directory); assert.notEqual(changed.fingerprint, original.fingerprint); assert.ok(changed.status);
    await writeFile(join(directory, 'new.mjs'), 'untracked');
    const untracked = await sourceEvidence(directory); assert.notEqual(untracked.fingerprint, changed.fingerprint);
    await rm(join(directory, 'source.mjs'));
    const deleted = await sourceEvidence(directory); assert.notEqual(deleted.fingerprint, untracked.fingerprint);
    assert.ok(!JSON.stringify(deleted).includes('TEST_ONLY_PRIVATE'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
