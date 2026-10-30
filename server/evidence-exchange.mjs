// Short references are a wire format, never a new source of truth. Each
// request owns its exact bijection; validators and checkpoints keep the
// content-bound IDs. Prose, quotes and unknown references are never rewritten.
export function evidenceExchange(messages, enabled = true) {
  if (!enabled) return { messages, restore: value => value };
  const decoded = messages.map(message => {
    try { return JSON.parse(message.content); } catch { return undefined; }
  });
  const sourceIds = new Map(), noteIds = new Map();
  for (const context of decoded) {
    for (const page of Array.isArray(context?.source) ? context.source : []) {
      for (const excerpt of Array.isArray(page.excerpts) ? page.excerpts : []) {
        if (/^e\d+-\d+-[a-f0-9]{12}$/.test(excerpt.id) && !sourceIds.has(excerpt.id)) sourceIds.set(excerpt.id, `S${sourceIds.size + 1}`);
      }
    }
    for (const block of Array.isArray(context?.blocks) ? context.blocks : []) {
      if (/^n\d+-[a-f0-9]{12}$/.test(block.evidenceId) && !noteIds.has(block.evidenceId)) noteIds.set(block.evidenceId, `B${noteIds.size + 1}`);
    }
  }
  if (!sourceIds.size && !noteIds.size) return { messages, restore: value => value };
  const reverseSource = new Map([...sourceIds].map(([key, value]) => [value, key]));
  const reverseNote = new Map([...noteIds].map(([key, value]) => [value, key]));
  const refs = (value, sources, notes) => {
    if (Array.isArray(value)) return value.map(item => refs(item, sources, notes));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      key === 'sourceEvidenceIds' && Array.isArray(item) ? item.map(id => sources.get(id) || id)
        : key === 'noteEvidenceId' && typeof item === 'string' ? notes.get(item) || item : refs(item, sources, notes)]));
  };
  return {
    messages: messages.map((message, index) => {
      if (!decoded[index]) return message;
      const value = refs(decoded[index], sourceIds, noteIds);
      for (const page of Array.isArray(value.source) ? value.source : []) {
        for (const excerpt of Array.isArray(page.excerpts) ? page.excerpts : []) excerpt.id = sourceIds.get(excerpt.id) || excerpt.id;
      }
      for (const block of Array.isArray(value.blocks) ? value.blocks : []) {
        if (block.evidenceId) block.evidenceId = noteIds.get(block.evidenceId) || block.evidenceId;
      }
      return { ...message, content: JSON.stringify(value) };
    }),
    restore(raw) {
      try { return JSON.stringify(refs(JSON.parse(raw), reverseSource, reverseNote)); }
      catch { return raw; } // Malformed JSON belongs to the recovery workbench.
    },
  };
}
