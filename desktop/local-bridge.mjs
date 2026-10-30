import http from 'node:http';
import { Readable } from 'node:stream';
import { appOrigin, isAppURL, contentSecurityPolicy } from './policy.mjs';

const json = (status, error, code) => new Response(JSON.stringify({ error, code }), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': contentSecurityPolicy },
});

// This channel connects two parts of the SAME local application. Node's fetch
// imposes a 300s response-header deadline, which is shorter than multi-stage
// note generation. Use a loopback-only HTTP stream with a connection deadline,
// but no total/header/body deadline. User cancellation still closes the socket
// and reaches the service's existing abort/checkpoint path. Never replay POSTs.
export function createLocalBridge(address, { report = () => {}, connectTimeout = 10000 } = {}) {
  const origin = new URL(address);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Expected the private loopback service origin');
  return async request => {
    if (!isAppURL(request.url) || (request.initiatorOrigin && request.initiatorOrigin !== appOrigin))
      return json(403, '来源不被允许。', 'LOCAL_REQUEST_FORBIDDEN');
    const url = new URL(request.url);
    try {
      request.signal?.throwIfAborted();
      const headers = {};
      for (const name of ['content-type', 'x-reading-tree-token', 'range']) if (request.headers.has(name)) headers[name] = request.headers.get(name);
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
      request.signal?.throwIfAborted();
      return await new Promise((resolve, reject) => {
        let incoming, connecting;
        // Fixed origin, path-only forwarding, no cookies, proxy or redirects.
        const outgoing = http.request({ hostname: origin.hostname, port: origin.port, path: url.pathname + url.search,
          method: request.method, headers, agent: false }, response => {
          incoming = response; clearTimeout(connecting);
          const resultHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) if (value !== undefined && !['connection', 'keep-alive', 'transfer-encoding'].includes(name))
            resultHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
          resultHeaders.set('content-security-policy', contentSecurityPolicy);
          const status = response.statusCode || 502;
          if (request.method === 'HEAD' || [204, 205, 304].includes(status)) {
            response.resume(); resolve(new Response(null, { status, headers: resultHeaders }));
          } else resolve(new Response(Readable.toWeb(response), { status, headers: resultHeaders }));
        });
        const abort = () => {
          const error = request.signal.reason instanceof Error ? request.signal.reason : new DOMException('Request cancelled', 'AbortError');
          incoming?.destroy(error); outgoing.destroy(error);
        };
        const cleanup = () => { clearTimeout(connecting); request.signal?.removeEventListener('abort', abort); };
        outgoing.once('error', reject);
        outgoing.once('close', cleanup);
        request.signal?.addEventListener('abort', abort, { once: true });
        connecting = setTimeout(() => outgoing.destroy(Object.assign(new Error('Loopback connection timeout'), { code: 'LOCAL_CONNECT_TIMEOUT' })), connectTimeout);
        outgoing.once('socket', socket => {
          if (!socket.connecting) clearTimeout(connecting);
          else socket.once('connect', () => clearTimeout(connecting));
        });
        if (request.signal?.aborted) abort();
        else outgoing.end(body);
      });
    } catch (error) {
      if (request.signal?.aborted) return json(499, '请求已取消。', 'LOCAL_REQUEST_CANCELLED');
      // Diagnostics are best-effort; failures must not replace the response.
      try { report({ layer: 'local-transport', stage: 'desktop-bridge', outcome: 'interrupted', error }); } catch {}
      return json(503, '本地应用连接中断，尚未确认本次结果。已保存的内容保留，请恢复连接后继续。', 'LOCAL_SERVICE_UNAVAILABLE');
    }
  };
}
