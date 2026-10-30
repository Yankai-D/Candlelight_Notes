import { openDB } from 'idb'
import type { LearningDocument } from './types'
import type { Collection } from './types'
import { commitNotebook } from '../shared/notebooks.mjs'
import { COURSE_STYLE_KEY, courseStylePreferences, courseStyleContext } from '../shared/course-style.mjs'
import { commitCourseStylePreferences } from '../shared/course-style-store.mjs'
import type { CourseStylePreferences } from './types'
import type { TemplateLibrary } from './types'
import type { Knowledge } from './types'
import { readLearnerSetup, commitLearnerSetup, resetLearnerSetup } from '../shared/learner-setup.mjs'
import { readTemplateLibrary, commitTemplateLibrary } from '../shared/template-library-store.mjs'
import { localFetch, readLocalJSON } from '../shared/local-api.mjs'

const database = openDB('reading-tree', 1, { upgrade(db) { db.createObjectStore('documents', { keyPath: 'id' }); db.createObjectStore('files'); db.createObjectStore('preferences') } })
let initialization: Promise<boolean> | undefined, token = '', workspaceToken = ''
async function request(command: object, binary = false, retry = true, path = '/api/storage'): Promise<any> {
  if (!token) { const config = await readLocalJSON(await localFetch('/api/config')); token = config.token; workspaceToken = config.workspaceToken || '' }
  const response = await localFetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-reading-tree-token': token }, body: JSON.stringify({ ...command, workspaceToken }) })
  if (response.status === 403 && retry) { token = ''; return request(command, binary, false, path) }
  if (!response.ok) return readLocalJSON(response)
  if (binary && !response.headers.get('content-type')?.includes('application/json')) return response.blob()
  return readLocalJSON(response)
}
async function encoded(file: Blob, name?: string) {
  return { name: name || (file instanceof File ? file.name : 'source.pdf'), data: await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取导入文件。')); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file)
  }) }
}
export async function parseRichMaterial(file: File): Promise<{sections: {title: string; text: string}[]; warnings: string[]}> {
  return request(await encoded(file), false, true, '/api/import/material')
}
async function initialize() {
  const config = await readLocalJSON(await localFetch('/api/config')); token = config.token; workspaceToken = config.workspaceToken || ''
  if (config.fileStorage !== true) return false
  try { const status = await request({ action: 'status' }); if (!status?.enabled) return false }
  catch (error) { if ((error as Error & {status?: number}).status === 404) return false; throw error }
  const db = await database, legacy = await db.getAll('documents')
  for (const document of legacy) {
    const file = await db.get('files', document.id)
    const receipt = await request({ action: 'import', document: commitNotebook(document), migration: true, ...(file ? { source: await encoded(file, document.filename) } : {}) })
    if (!receipt.verified) throw new Error('旧资料尚未完成文件校验，原数据已保留。')
  }
  const preferenceKeys = await db.getAllKeys('preferences'), values: Record<string, unknown> = {}
  for (const key of preferenceKeys) values[String(key)] = await db.get('preferences', key)
  await request({ action: 'migrate-preferences', values })
  // Delete old copies only after every file and preference is durable. If an
  // older tab wrote during migration, abort this transaction and retain it all.
  const tx = db.transaction(['documents', 'files', 'preferences'], 'readwrite')
  try {
    for (const document of legacy) {
      if (JSON.stringify(await tx.objectStore('documents').get(document.id)) !== JSON.stringify(document)) throw new Error('迁移期间旧窗口修改了笔记，请关闭旧窗口后重试。')
      await tx.objectStore('documents').delete(document.id); await tx.objectStore('files').delete(document.id)
    }
    for (const key of preferenceKeys) {
      if (JSON.stringify(await tx.objectStore('preferences').get(key)) !== JSON.stringify(values[String(key)])) throw new Error('迁移期间设置发生变化，请重新打开。')
      await tx.objectStore('preferences').delete(key)
    }
    await tx.done
  } catch (error) { try { tx.abort() } catch {} await tx.done.catch(() => {}); throw error }
  await request({ action: 'migration-complete' }); return true
}
async function fileStorage() { return initialization ||= initialize().catch(error => { initialization = undefined; throw error }) }
export type StorageSettings = { enabled: boolean; directory?: string; discovery?: boolean; maintenance?: boolean; previousWorkspaceAvailable?: boolean }
export async function maintainWorkspace(command: object): Promise<any> { if (!await fileStorage()) throw new Error('请启用文件存储后管理资料。'); return track(request(command)) }
export async function restoreSource(id: string, file: File) { return maintainWorkspace({ action: 'source-restore', id, source: await encoded(file) }) }
export async function saveConflictCopy(document: LearningDocument) { return maintainWorkspace({ action: 'conflict-copy', document: commitNotebook(document) }) }
export type DiscoveredNotes = { id: string; directory: string; issueCount: number; issues: {path: string; reason: string}[]; items: { key: string; id: string; title: string; path: string; status: 'new' | 'known' | 'moved' | 'conflict'; missingSource: boolean; ignored: boolean }[] }
export async function scanNotes(directory: string): Promise<DiscoveredNotes> { if (!await fileStorage()) throw new Error('请更新本机服务后识别已有笔记。'); return request({ action: 'scan', directory }) }
export function attachNotes(scanId: string, keys: string[], remember: boolean): Promise<{ids: string[]; count: number}> { return track(request({ action: 'attach', scanId, keys, remember })) }
export async function storageSettings(): Promise<StorageSettings> { return await fileStorage() ? request({ action: 'status' }) : { enabled: false } }
export async function setStorageDirectory(directory: string): Promise<{directory: string}> { if (!await fileStorage()) throw new Error('请更新本机服务后设置资料目录。'); return request({ action: 'directory', directory }) }
export async function inspectDocument(id: string): Promise<{missing: string[]; notePath?: string; sourcePath?: string}> { return await fileStorage() ? request({ action: 'inspect', id }) : { missing: [] } }
const writes = new Set<Promise<unknown>>()
let writesSuspended = false
export function reloadWorkspace() { writesSuspended = true; window.location.reload() }
function track<T>(operation: Promise<T>): Promise<T> {
  writes.add(operation)
  void operation.then(() => writes.delete(operation), () => writes.delete(operation))
  return operation
}
export async function flushWrites() { while (writes.size) await Promise.all([...writes]) }
export async function readDocuments(): Promise<LearningDocument[]> { return await fileStorage() ? request({ action: 'list' }) : (await database).getAll('documents') }
export function saveDocument(doc: LearningDocument) { return track((async () => {
  if (doc.storageIssue || writesSuspended) return
  return await fileStorage() ? request({ action: 'save', document: commitNotebook(doc) }) : (await database).put('documents', commitNotebook(doc))
})()) }
export function importDocument(doc: LearningDocument, file?: File, directory?: string) { return track((async () => {
  if (await fileStorage()) return request({ action: 'import', document: commitNotebook(doc), directory, remember: true, ...(file ? { source: await encoded(file) } : {}) })
  const db = await database, tx = db.transaction(['documents', 'files'], 'readwrite')
  await tx.objectStore('documents').put(commitNotebook(doc)); if (file && !/\.json$/i.test(file.name)) await tx.objectStore('files').put(file, doc.id); await tx.done
})()) }
export function saveDocumentInCollection(doc: LearningDocument, collection: Collection) { return track((async () => {
  if (await fileStorage()) { await request({ action: 'save', document: commitNotebook(doc) }); await request({ action: 'preference-set', key: 'collection', value: collection }); return }
  const db = await database
  const tx = db.transaction(['documents', 'preferences'], 'readwrite');
  await Promise.all([tx.objectStore('documents').put(commitNotebook(doc)), tx.objectStore('preferences').put(collection, 'collection')]);
  await tx.done;
})()) }
export function saveFile(id: string, file: Blob) { return track((async () => { if (!await fileStorage()) return (await database).put('files', file, id) })()) }
export async function readFile(id: string): Promise<Blob | undefined> { return await fileStorage() ? (await request({ action: 'file', id }, true)) || undefined : (await database).get('files', id) }
export function removeDocument(id: string, recordOnly = false) { return track((async () => {
  if (await fileStorage()) return request({ action: 'remove', id, recordOnly })
  const db = await database, tx = db.transaction(['documents', 'files'], 'readwrite'); await Promise.all([tx.objectStore('documents').delete(id), tx.objectStore('files').delete(id)]); await tx.done
})()) }
export async function getPreference(key: string) { return await fileStorage() ? request({ action: 'preference-get', key }) : (await database).get('preferences', key) }
export function setPreference(key: string, value: unknown) { return track((async () => await fileStorage() ? request({ action: 'preference-set', key, value }) : (await database).put('preferences', value, key))()) }
export async function readLearner(): Promise<{ knowledge: Knowledge; step: 'profile' | 'connection' | null }> { return await fileStorage() ? request({ action: 'learner-read' }) : readLearnerSetup(await database) }
export function saveLearner(value: Knowledge, step: 'profile' | 'connection' | 'complete'): Promise<Knowledge> { return track((async () => await fileStorage() ? request({ action: 'learner-save', value, step }) : commitLearnerSetup(await database, value, step))()) }
export function resetLearner(): Promise<Knowledge> { return track((async () => await fileStorage() ? request({ action: 'learner-reset' }) : resetLearnerSetup(await database))()) }
export async function readCourseStyle(): Promise<CourseStylePreferences> { return courseStylePreferences(await getPreference(COURSE_STYLE_KEY)) }
export function saveCourseStyle(value: CourseStylePreferences, expectedRevision: number): Promise<CourseStylePreferences> { return track((async () => await fileStorage() ? request({ action: 'course-save', value, revision: expectedRevision }) : commitCourseStylePreferences(await database, value, expectedRevision))()) }
// Call once when constructing a course generation request; retain this snapshot
// for every section, retry and later resume of the same generation.
export async function readCourseStyleContext() { return courseStyleContext(await readCourseStyle()) }
export async function readTemplates(): Promise<TemplateLibrary> { return await fileStorage() ? request({ action: 'templates-read' }) : readTemplateLibrary(await database) }
export function saveTemplates(value: TemplateLibrary, expectedRevision: number): Promise<TemplateLibrary> { return track((async () => await fileStorage() ? request({ action: 'templates-save', value, revision: expectedRevision }) : commitTemplateLibrary(await database, value, expectedRevision))()) }
