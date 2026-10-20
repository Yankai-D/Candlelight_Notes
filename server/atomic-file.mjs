import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { recoverOperation, recordRecovery } from './recovery.mjs';

// Retry the replacement of the SAME completed snapshot. Never unlink the
// destination or rerun a model to work around a OneDrive/AV sharing lock.
export async function atomicWrite(path, data, options = {}) {
  const io = options.io || fs, temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await io.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    await recoverOperation(() => io.rename(temporary, path), { layer:'storage',stage:'atomic-replace',...options });
  } catch (error) {
    if (['EPERM','EACCES','EBUSY'].includes(error.code)) throw Object.assign(new Error('文件暂时被同步程序占用或没有写入权限，自动重试后仍无法保存。已保留原文件，请等待同步完成或检查资料目录权限。'), {code:'STORAGE_BUSY',cause:error});
    throw error;
  } finally {
    await io.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') recordRecovery({layer:'storage',stage:'temporary-cleanup',outcome:'deferred',error}); });
  }
}
