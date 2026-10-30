// Only provider-reported usage is summed. Missing cache fields are unknown,
// never inferred to be cache misses or converted into a currency estimate.
export function generationUsage(events = []) {
  const stages = new Map();
  for (const event of events) {
    if (!Number.isFinite(event.promptTokens) && !Number.isFinite(event.completionTokens)) continue;
    const stage = event.stage || 'unclassified-legacy';
    if (!stages.has(stage)) stages.set(stage, { stage, completions: 0, inputTokens: 0, outputTokens: 0,
      cacheHitTokens: 0, cacheMissTokens: 0, cacheReportedCalls: 0, elapsedMs: 0, timedCalls: 0 });
    const value = stages.get(stage); value.completions++;
    value.inputTokens += event.promptTokens || 0; value.outputTokens += event.completionTokens || 0;
    if (Number.isFinite(event.cacheHitTokens) && Number.isFinite(event.cacheMissTokens)) {
      value.cacheReportedCalls++; value.cacheHitTokens += event.cacheHitTokens; value.cacheMissTokens += event.cacheMissTokens;
    }
    if (Number.isFinite(event.elapsedMs)) { value.elapsedMs += event.elapsedMs; value.timedCalls++; }
  }
  return [...stages.values()];
}
