import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { LearningDocument, Chapter } from './types'
import { paragraph, uid } from '../shared/document.mjs'
import { defaultLearningIntent } from '../shared/learning-intent.mjs'
import { richMaterial } from '../shared/material-formats.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
export { pdfjs }

export async function importMaterial(file: File, intent: string, progress: (message: string) => void): Promise<LearningDocument> {
  if (file.size > 50 * 1024 * 1024) throw new Error('第一版支持 50 MB 以内的资料。')
  if (/\.json$/i.test(file.name)) return (await import('../shared/backup.mjs')).restoreBackup(await file.text()) as LearningDocument
  const id = uid()
  let pages: LearningDocument['pages'] = []
  let chapters: Chapter[] = []
  let sourceWarnings: string[] = []
  const pdf = /\.pdf$/i.test(file.name)
  const makeChapter = (title: string, pageNumbers: number[]): Chapter => ({ id: uid(), title, sourcePages: pageNumbers, status: 'empty', content: { type: 'doc', content: [paragraph('')] } })
  if (pdf) {
    const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    let document
    try {
      document = await loading.promise
      if (document.numPages > 1000) throw new Error('第一版支持 1,000 页以内的资料，请拆分后导入。')
      for (let n = 1; n <= document.numPages; n++) {
        progress(`正在读取第 ${n} / ${document.numPages} 页`)
        const page = await document.getPage(n)
        const content = await page.getTextContent()
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
        pages.push({ number: n, text })
      }
      if (!pages.some(p => p.text.length > 30)) throw new Error('这份 PDF 没有可提取的文字。当前版本暂不支持扫描件 OCR，请导入文本型 PDF 或 Markdown。')
      const outline = await document.getOutline()
      const starts: { title: string; page: number }[] = []
      if (outline) for (const item of outline) {
        try {
          const dest = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest
          if (!dest?.length) continue
          const page = typeof dest[0] === 'number' ? dest[0] + 1 : await document.getPageIndex(dest[0]) + 1
          if (!starts.some(s => s.page === page)) starts.push({ title: item.title, page })
        } catch { /* Broken bookmarks fall back to page grouping. */ }
      }
      starts.sort((a, b) => a.page - b.page)
      if (starts.length && starts[0].page > 1) starts.unshift({ title: '开篇', page: 1 })
      // Split very long bookmark sections so each generation is bounded and resumable.
      if (starts.length) starts.forEach((s, i) => {
        const end = (starts[i + 1]?.page || document!.numPages + 1) - 1
        for (let n = s.page; n <= end; n += 5) chapters.push(makeChapter(s.title + (n > s.page ? ` · 续 ${Math.floor((n - s.page) / 5) + 1}` : ''), Array.from({ length: Math.min(5, end - n + 1) }, (_, j) => n + j)))
      })
      else for (let n = 1; n <= pages.length; n += 3) chapters.push(makeChapter(`第 ${n}${Math.min(n + 2, pages.length) > n ? `–${Math.min(n + 2, pages.length)}` : ''} 页`, pages.slice(n - 1, n + 2).map(p => p.number)))
    } finally { await loading.destroy() }
  } else {
    if (!/\.(txt|md|markdown)$/i.test(file.name) && !richMaterial(file.name)) throw new Error('请选择 PDF、DOCX、PPTX、HTML、Markdown 或 TXT 文件；旧版 DOC/PPT 请先另存为 DOCX/PPTX。')
    let sections: {title: string; text: string}[]
    if (richMaterial(file.name)) {
      progress('正在提取标题与正文…')
      const result = await (await import('./storage')).parseRichMaterial(file)
      sections = result.sections; sourceWarnings = result.warnings
    } else {
      const content = (await file.text()).trim()
      if (!content) throw new Error('文件内容为空。')
      sections = content.split(/(?=^#{1,2}\s)/m).filter(s => s.trim()).map(text => ({text, title: text.match(/^#{1,2}\s+(.+)/)?.[1]?.trim().slice(0, 100) || ''}))
    }
    for (const section of sections) {
      // Bounded slices for long plain text; retain all source text.
      for (let offset = 0; offset < section.text.length; offset += 16000) {
        const part = section.text.slice(offset, offset + 16000)
        pages.push({ number: pages.length + 1, text: part })
        chapters.push(makeChapter((section.title || `阅读片段 ${pages.length}`) + (offset ? ` · 续 ${Math.floor(offset / 16000) + 1}` : ''), [pages.length]))
      }
    }
  }
  if (chapters.length > 300) throw new Error('资料章节过多，请按主题拆分后再导入。')
  const now = Date.now()
  const learningIntent = intent.trim() || defaultLearningIntent
  return { id, title: file.name.replace(/\.[^.]+$/, ''), subtitle: '我的学习资料', filename: file.name, kind: pdf ? 'pdf' : 'text', ...(sourceWarnings.length ? {sourceWarnings} : {}), intent: learningIntent, intentSource: learningIntent === defaultLearningIntent ? 'default' : 'user', createdAt: now, updatedAt: now, revision: 0, pages, chapters, currentChapter: chapters[0].id, currentPage: 1, versions: [] }
}
