// Shared by the review page's print button and the offline long-PDF exporter.
// Keep the already rendered prose and SVG math; printing never regenerates notes.
export const reviewPrintCSS = `
.review-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.review-print footer, .review-print label, .review-print .screen-only,
.review-print details:has(input, select, textarea) { display: none !important; }
.review-print summary { display: block; cursor: default; }
.review-print summary::-webkit-details-marker { display: none; }
.review-print .columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.review-print .math-display { overflow: visible; }
.review-print h2, .review-print h3, .review-print h4 { break-after: avoid; }
.review-print .note p { orphans: 3; widows: 3; }
.review-print section { margin-top: 48px; }
.print-only { display: none; }
.review-print .print-only { display: block; }
@media print {
  @page { size: A3 landscape; margin: 12mm; }
  main { max-width: 1440px; padding: 0; }
}
`;

// Runs inside the browser. Restore disclosure state after printing without
// replacing DOM nodes or touching the reviewer's unsaved form values.
export function prepareReviewPrint() {
  const closed = [...document.querySelectorAll('details')].filter(detail =>
    !detail.open && !detail.querySelector('input, select, textarea') && !detail.closest('article'));
  closed.forEach(detail => { detail.open = true; });
  document.body.classList.add('review-print');
  return () => {
    closed.forEach(detail => { detail.open = false; });
    document.body.classList.remove('review-print');
  };
}
