const roots = new Set(['src','server','shared','desktop','packaging','scripts','tests','docs','evals','examples','public','materials','.github']);
const files = new Set(['.env.example','.gitignore','.gitattributes','.node-version','README.md','ACKNOWLEDGEMENTS.md','PUBLICATION.md','PUBLIC-SOURCE.json','package.json','package-lock.json','index.html','tsconfig.json','vite.config.ts']);
export function publicSourcePath(path) {
  if (!path || /[\\\r\n\0:]/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Invalid source path');
  if (/(^|\/)(\.git|\.env(?:\..*)?|\.local[^/]*|node_modules|dist|artifacts|output|backups|data|\.cache)(\/|$)/i.test(path) && path !== '.env.example') throw new Error('Private or generated source path');
  if (/(^|\/)(note\.candlelight\.json|library-index\.json|preferences\.json|workspace-(pending|previous)\.json)$/.test(path)) throw new Error('Personal learning state');
  if (!files.has(path) && !roots.has(path.split('/')[0])) throw new Error('Source path is not in the public allowlist');
  if (/\.(exe|zip|log|pem|key|pfx|sqlite|db)$/i.test(path)) throw new Error('Non-source asset');
  if (/\.pdf$/i.test(path) && path !== 'public/attention-field-notes.pdf' && !/^materials\/descriptive-statistics\/(01-selected-reading|02-numerical-data|03-categorical-data)\.pdf$/.test(path)) throw new Error('Unapproved PDF');
  return true;
}
export function auditPublicText(text, currentKey = '', privateNames = []) {
  if (/(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/.test(text) || currentKey.length > 8 && text.includes(currentKey)) throw new Error('Credential-like content');
  if (/(?:[a-z]:[\\/]+(?:Users|develop))/i.test(text) || privateNames.some(name => name.length > 3 && text.includes(name))) throw new Error('Personal machine path');
}
export function publicRecord(value) {
  if (Array.isArray(value)) return value.map(publicRecord);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'selfUse').map(([key, entry]) => [key, publicRecord(entry)]));
  return value;
}
