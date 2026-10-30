import { noteFailureMetadata } from './note-recovery.mjs';

export function localConnectionError(cause) {
  if (cause?.name === 'AbortError') return cause;
  return Object.assign(new Error('本地应用连接中断，尚未确认本次结果。已保存的内容保留，请恢复连接后继续。'),
    { code: 'LOCAL_SERVICE_UNAVAILABLE', recovery: { stopRun: true }, cause });
}

// A local transport error is not malformed MODEL output. Never print HTML or
// proxy error bodies as JSON syntax errors, and never blindly replay mutations.
export async function localFetch(path, options) {
  try { return await fetch(path, options); }
  catch (error) { if (options?.signal?.aborted) throw options.signal.reason; throw localConnectionError(error); }
}
export async function readLocalJSON(response) {
  let text;
  try { text = await response.text(); }
  catch (error) { throw localConnectionError(error); }
  let data;
  try { data = JSON.parse(text); }
  catch {
    const error = response.ok
      ? Object.assign(new Error('本地服务返回了无法识别的响应，尚未确认本次结果。已保存的内容保留。'), { code: 'LOCAL_RESPONSE_INVALID', recovery: { stopRun: true } })
      : localConnectionError();
    throw Object.assign(error, { status: response.status });
  }
  if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : '本地请求未完成。'),
    { status: response.status, ...(data.progress ? { progress: data.progress } : {}) }, noteFailureMetadata(data), response.status >= 500 ? { code: 'LOCAL_SERVICE_UNAVAILABLE', recovery: { stopRun: true } } : {});
  return data;
}
