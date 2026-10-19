export const materialFormats = {
  pdf: { extension: 'pdf', mime: 'application/pdf' },
  txt: { extension: 'txt', mime: 'text/plain' },
  md: { extension: 'md', mime: 'text/markdown' },
  markdown: { extension: 'md', mime: 'text/markdown' },
  html: { extension: 'html', mime: 'text/html' },
  htm: { extension: 'html', mime: 'text/html' },
  docx: { extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { extension: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
};
export const materialAccept = Object.keys(materialFormats).map(extension => '.' + extension).join(',');
export const sourceNames = [...new Set(Object.values(materialFormats).map(format => 'source.' + format.extension)), 'source.json'];
export function materialFormat(filename = '') { return materialFormats[filename.split('.').at(-1)?.toLowerCase()]; }
export const richMaterial = filename => /\.(docx|pptx|html?)$/i.test(filename);
