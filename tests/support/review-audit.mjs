// Existing recovery scenarios hold the audit verdict fixed to "confirm".
// Dismissal, uncertainty, scope and real request counts have dedicated tests.
export function confirmedAudit(messages) {
  if (!messages[0].content.startsWith('note-review-audit-v1')) return undefined;
  const context = JSON.parse(messages[1].content);
  return { candidateDigest: context.binding, decisions: context.review.findings.map(finding => ({
    findingId: finding.id, verdict: 'confirm',
    reason: 'This offline fixture confirms the supplied finding so the downstream recovery contract can be tested.',
    sourceEvidenceIds: finding.sourceEvidenceIds?.length ? finding.sourceEvidenceIds
      : context.source.filter(page => finding.sourcePages.includes(page.number)).flatMap(page => page.excerpts.slice(0, 1).map(e => e.id)).slice(0, 8),
  })) };
}
