import { z } from 'zod';
export const progressIdSchema = z.string().uuid();
const known = value => Number.isSafeInteger(value) && value >= 0;

// Only compact counters leave this store: no source text, prompts, diagnoses,
// provider credentials or raw responses. Completed entries expire in memory.
export function generationProgressStore({ now = Date.now, retentionMs = 10 * 60 * 1000, retained = 128 } = {}) {
  const entries = new Map();
  const prune = () => {
    const ended = [...entries.values()].filter(v => v.state !== 'running').sort((a,b) => b.updatedAt - a.updatedAt);
    ended.forEach((entry, index) => { if (index >= retained || now() - entry.updatedAt > retentionMs) entries.delete(entry.id); });
  };
  const snapshot = value => { const { workspace, ...safe } = value; return { ...safe, stages: value.stages.map(row => ({ ...row })), elapsedMs: Math.max(0, (value.state === 'running' ? now() : value.updatedAt) - value.startedAt) }; };
  return {
    get(id, workspace) { prune(); const value = entries.get(progressIdSchema.parse(id)); return value?.workspace === workspace ? snapshot(value) : null; },
    start(id, workspace, stage) {
      progressIdSchema.parse(id); prune();
      if (entries.has(id)) throw new Error('这次生成标识已被使用，请重新发起操作。');
      const value = { id, workspace, startedAt: now(), updatedAt: now(), state: 'running', stage, phase: 'preparing',
        requests: 0, reportedCalls: 0, inputTokens: 0, outputTokens: 0, cacheReportedCalls: 0, cacheHitTokens: 0, repairs: 0, indexReused: 0, stages: [] };
      entries.set(id, value);
      const stageRow = stage => {
        const key = typeof stage === 'string' && stage.length <= 80 ? stage : 'other';
        let row = value.stages.find(row => row.stage === key);
        if (!row) { row = { stage: key, requests: 0, reportedCalls: 0, inputTokens: 0, outputTokens: 0 }; value.stages.push(row); }
        return row;
      };
      return {
        request(info = {}) { value.requests++; value.stage = info.stage || stage; stageRow(value.stage).requests++; value.phase = 'request'; value.updatedAt = now(); },
        event(event) {
          value.updatedAt = now();
          if (event.phase === 'execution') { value.stage = event.stage || value.stage; value.phase = event.status; if (event.status === 'recovering') value.repairs++; }
          if (Object.hasOwn(event, 'finishReason')) {
            value.stage = event.stage || value.stage; value.phase = 'validating';
            const row = stageRow(value.stage);
            if (known(event.promptTokens) && known(event.completionTokens)) { value.reportedCalls++; row.reportedCalls++; }
            if (known(event.promptTokens)) { value.inputTokens += event.promptTokens; row.inputTokens += event.promptTokens; }
            if (known(event.completionTokens)) { value.outputTokens += event.completionTokens; row.outputTokens += event.completionTokens; }
            if (known(event.cacheHitTokens) && known(event.cacheMissTokens)) { value.cacheReportedCalls++; value.cacheHitTokens += event.cacheHitTokens; }
          }
          if (event.phase === 'source-knowledge-cache' && known(event.reused)) value.indexReused += event.reused;
        },
        finish(state) { value.state = state; value.updatedAt = now(); prune(); return snapshot(value); },
      };
    },
  };
}
