// Context windows, not execution quotas. Full inputs/candidates stay in the
// local workbench and remain addressable with exact paths at any time.
const wire = value => typeof value === 'string' ? value : JSON.stringify(value);
function decode(content) { try { return JSON.parse(content); } catch { return content; } }

export function recoveryIndex(value, limit = 7000, path = []) {
  let remaining = limit;
  function visit(item, at, depth) {
    if (remaining < 240) return { path: at, omitted: true };
    const rendered = wire(item) ?? '';
    const node = { path: at, kind: Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item, characters: rendered.length };
    remaining -= JSON.stringify(node).length + 60;
    if (!item || typeof item !== 'object') {
      if (rendered.length <= 180) node.value = item;
      else { node.preview = rendered.slice(0, 160); node.truncated = true; }
      remaining -= Math.min(rendered.length, 180);
    } else {
      node.keys = Object.keys(item).slice(0, 32);
      remaining -= JSON.stringify(node.keys).length;
      if (Array.isArray(item)) node.length = item.length;
      if (depth < 4) {
        node.children = [];
        const entries = Object.entries(item).slice(0, Array.isArray(item) ? 3 : 24);
        for (const [key, child] of entries) {
          if (remaining < 240) break;
          node.children.push(visit(child, [...at, Array.isArray(item) ? Number(key) : key], depth + 1));
        }
        node.truncated = node.children.length !== Object.keys(item).length;
      } else node.truncated = true;
    }
    return node;
  }
  return visit(value, path, 0);
}

function atPath(value, path) {
  for (const key of path) {
    if (!value || typeof value !== 'object' || ['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(value, key)) return { exists: false };
    value = value[key];
  }
  return { exists: true, value };
}

export function recoveryInput(messages, raw, failure) {
  const candidate = decode(wire(raw)), original = messages.slice(1);
  const context = original.map(message => ({ role: message.role, content: decode(message.content) }));
  const focus = [], seen = new Set(); let size = 0;
  for (const issue of failure.issues || []) {
    if (!Array.isArray(issue.path)) continue;
    // One parent provides the field's purpose as well as its current value.
    const path = issue.path.length > 1 ? issue.path.slice(0, -1) : issue.path;
    if (seen.has(JSON.stringify(path))) continue;
    seen.add(JSON.stringify(path));
    const field = atPath(candidate, path), rendered = wire(field.value) ?? '';
    const item = { path, ...(!field.exists ? { exists: false } : rendered.length <= 2600
      ? { exists: true, value: field.value } : { exists: true, index: recoveryIndex(field.value, 1800, path) }) };
    size += JSON.stringify(item).length;
    if (size > 9000) break;
    focus.push(item);
  }
  return {
    // Task requirements are not retrieval hints. Keep them complete even when
    // source-first ordering would exhaust the structural index's window.
    taskContext: context.map(({ role, content }) => ({ role, fields: content && typeof content === 'object'
      ? Object.fromEntries(['task', 'goal', 'learningIntent', 'instruction', 'binding', 'chapterId', 'segment']
        .filter(key => Object.hasOwn(content, key)).map(key => [key, content[key]])) : {} })),
    ...(wire(original).length <= 12000 ? { originalContext: original } : { contextIndex: recoveryIndex(context, 8500) }),
    ...(wire(raw).length <= 12000 ? { rejectedResult: raw } : { candidateIndex: recoveryIndex(candidate, 6500) }),
    focusedFields: focus,
    contextPolicy: '摘要、preview 和 index 只用于定位，不是完整证据。未发送的原始上下文与返回值完整保留在本地；用 inspect/search 读取精确路径。小字段修复优先利用 failure、focusedFields 和已有观察，信息足够就直接提交 patch，不为确认已知值重复读取。',
  };
}

export function recoveryObservations(investigation, digest, limit = 14000) {
  const current = investigation.filter(item => (item.observation?.targetDigest || item.observation?.candidateDigest) === digest);
  const selected = []; let size = 0;
  for (const item of current.slice(-8).reverse()) {
    const length = JSON.stringify(item).length;
    if (size + length > limit) continue;
    selected.unshift(item); size += length;
  }
  return selected;
}

export function recoveryFailure(failure) {
  const expectations = {}, known = new Map();
  const issues = (failure.issues || []).map(issue => {
    if (issue.expected === undefined || JSON.stringify(issue.expected).length < 400) return issue;
    const key = JSON.stringify(issue.expected);
    let id = known.get(key);
    if (!id) { id = `expected${known.size + 1}`; known.set(key, id); expectations[id] = issue.expected; }
    return { ...issue, expected: { lookup: `failure.expectations.${id}` } };
  });
  return { ...failure, issues, ...(known.size ? { expectations } : {}) };
}

export function recoveryHistory(history) {
  return history.slice(-4).map(({ strategy, cause, instruction, candidateDigest, failure }) => ({ strategy, cause, instruction, candidateDigest,
    failure: failure && { code: failure.code, message: failure.message, issues: (failure.issues || []).map(({ path, code, message }) => ({ path, code, message })) } }));
}
