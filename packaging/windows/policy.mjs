export function validateDistributionPath(name) {
  if(name.startsWith('/')||name.split('/').some(part=>part==='..')||name.includes('\\'))throw new Error(`Unsafe distribution path: ${name}`);
  if(/(^|\/)(\.env(?:\..*)?|\.git)(\/|$)/i.test(name)
    || /^(?:app\/)?(?:\.local-library|\.local-ideal-trees|\.local-storage|\.cache|data|artifacts|backups)(\/|$)/i.test(name)) {
    throw new Error(`Private artifact in distribution: ${name}`);
  }
  if(/\.pdf$/i.test(name)&&!/^materials\/descriptive-statistics-(textbook|numerical|categorical)\.pdf$/.test(name))throw new Error(`Unexpected PDF: ${name}`);
}
