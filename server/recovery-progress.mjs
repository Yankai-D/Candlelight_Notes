import { createHash } from 'node:crypto';
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const decode = raw => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return raw; } };
function field(value, path) {
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return { exists: false };
    value = value[key];
  }
  return { exists: true, value };
}

// Persist hashes of actual failed states and evidence, not retry counters or
// prose hypotheses. Changing an instruction does not reopen a failed method.
export function recoveryFrontier(raw, failure) {
  const value = decode(raw), paths = (failure.issues || []).filter(issue => Array.isArray(issue.path) && issue.path.length);
  const constraints = paths.map(issue => ({ path: issue.path, code: issue.code, expected: issue.expected,
    minimum: issue.minimum, maximum: issue.maximum, refs: issue.refs, current: field(value, issue.path) }));
  return hash(paths.length ? { code: failure.code, constraints } : { code: failure.code, message: failure.message, value });
}
export function progressTracker(entry, raw, failure) {
  entry.progress ||= { version: 1, attempts: {}, evidence: {} };
  const progress = entry.progress, frontier = recoveryFrontier(raw, failure);
  progress.rejectedCandidates ||= {};
  progress.rejectedCandidates[hash(decode(raw))] = true;
  const evidenceKey = () => hash(Object.keys(progress.evidence).sort());
  const key = strategy => hash({ frontier, strategy, evidence: evidenceKey() });
  return {
    frontier,
    seenCandidate: candidate => Boolean(progress.rejectedCandidates[hash(decode(candidate))]),
    blocked: strategy => Boolean(progress.attempts[key(strategy)]),
    attempted(strategy) { progress.attempts[key(strategy)] = true; },
    observe(observation) {
      if (observation.status === 'rejected') return false;
      // No matches, pagination metadata, offsets and altered search wording are
      // not new evidence. Only actual returned data can reopen an approach.
      const content = observation.matches ? observation.matches.map(match => match.excerpt).filter(Boolean)
        : observation.entries ? observation.entries.map(entry => entry.value ?? entry.excerpt)
          : observation.value !== undefined ? observation.value : observation.excerpt;
      if (content === undefined || content === '' || Array.isArray(content) && !content.length) return false;
      const id = hash({ target: observation.target, content });
      if (progress.evidence[id]) return false;
      progress.evidence[id] = true; return true;
    },
    context(strategies) { return { frontier, unavailableMethods: strategies.filter(strategy => this.blocked(strategy)),
      rule: '同一失败字段与实际结果下，已尝试的方法不能仅换措辞再执行。先读取新的实际证据、局部修正相关字段，或选择其他方法；空搜索和重复读取不算新证据。没有固定重试额度。' }; },
  };
}
