export const appOrigin = 'pangzhu://app';
export function isAppURL(value) {
  try { const url = new URL(value); return url.protocol === 'pangzhu:' && url.host === 'app' && !url.username && !url.password; }
  catch { return false; }
}
export function externalURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function rendererOptions(preload) {
  return { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false };
}
export const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'";
