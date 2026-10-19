// Inspect the production HTTP validation -> shared print renderer boundary.
// The real Chromium/PDF transport is covered separately in api/pdf tests.
import { setPDFRenderer } from '../../server/index.mjs';
import { printHTML } from '../../server/print-document.mjs';
setPDFRenderer(async (document, options) => Buffer.from(await printHTML(document, options)));
