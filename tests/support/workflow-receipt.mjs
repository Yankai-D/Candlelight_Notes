// Synthetic receipt for UI-only mocks. Model review itself is exercised by the
// real runner in note-workflow-review.test.mjs, not simulated by this helper.
export function mockWorkflowReceipt(request, overrides = {}) {
  if (!request.workflow) return undefined;
  return { version: 1, id: request.workflow.id, attempt: request.workflow.attempt, chapterId: request.chapterId,
    outcome: 'accepted', totalSegments: 1, reviewedSegments: 1, reviewCalls: 1, repairsUsed: 0, diagnoses: [], ...overrides };
}
