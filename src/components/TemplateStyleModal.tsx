import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Check, FileText, ListChecks, LoaderCircle, Plus, RotateCcw, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { Modal } from './Modal'
import { builtInTemplates, changeTemplateLibrary, MAX_TEMPLATES, templateSnapshot } from '../../shared/writing-templates.mjs'
import { defaultCourseSample } from '../../shared/course-style.mjs'
import { templateCatalog } from '../../shared/template-routing.mjs'
import * as storage from '../storage'
import type { TemplateDefinition, TemplateLibrary } from '../types'

const Preview = lazy(() => import('./CourseSamplePreview').then(module => ({ default: module.CourseSamplePreview })))
type Api = (path: string, body: unknown, signal?: AbortSignal) => Promise<any>
export function SettingsSections({ current, onModel, onCourse, onStartup, onStorage }: { current: 'model' | 'course' | 'startup' | 'storage'; onModel: () => void; onCourse: () => void; onStartup?: () => void; onStorage?: () => void }) {
  return <nav className="settings-sections" aria-label="设置分类"><button aria-current={current === 'model' ? 'page' : undefined} onClick={onModel}>模型连接</button><button aria-current={current === 'course' ? 'page' : undefined} onClick={onCourse}>模板风格</button>{onStartup&&<button aria-current={current === 'startup' ? 'page' : undefined} onClick={onStartup}>阅读启动</button>}{onStorage&&<button aria-current={current === 'storage' ? 'page' : undefined} onClick={onStorage}>资料存储</button>}</nav>
}
export function TemplateStyleModal({ configured, api, onClose, onModel, onStartup, onStorage }: { configured: boolean; api: Api; onClose: () => void; onModel: () => void; onStartup?: () => void; onStorage?: () => void }) {
  const [library, setLibrary] = useState<TemplateLibrary | null>(null), [activeId, setActiveId] = useState('narrative')
  const [instruction, setInstruction] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [busy, setBusy] = useState<'model' | 'saving' | ''>(''), [form, setForm] = useState<'new' | 'edit' | ''>('')
  const [definition, setDefinition] = useState<TemplateDefinition>({ name: '', audience: '', organization: '' }), [confirmDelete, setConfirmDelete] = useState(false)
  const live = useRef(true), request = useRef<AbortController | null>(null), working = useRef(false), scroll = useRef<HTMLElement>(null)
  useEffect(() => {
    live.current = true
    void storage.readTemplates().then(value => { if (live.current) setLibrary(value) }).catch(() => { if (live.current) setError('模板暂时无法读取，请关闭后重试。') })
    return () => { live.current = false; request.current?.abort() }
  }, [])
  const template = library?.templates.find(t => t.id === activeId)
  const sample = template?.selectedSample === 'personal' ? template.personalSample : template?.defaultSample
  const custom = template?.layout === 'custom'
  function leave(action: () => void) { if (busy === 'saving') return; request.current?.abort(); action() }
  async function commit(next: TemplateLibrary, expected: number) {
    setBusy('saving'); const saved = await storage.saveTemplates(next, expected)
    if (live.current) setLibrary(saved)
  }
  async function change(action: any, feedback: string) {
    if (!library || working.current) return
    working.current = true; setError(''); setMessage('')
    try {
      await commit(changeTemplateLibrary(library, { id: activeId, ...action }), library.revision)
      if (!live.current) return
      setMessage(feedback); setConfirmDelete(false)
      if (action.type === 'delete') setActiveId('narrative')
      if (action.type === 'definition') setForm('')
      if (action.type === 'reset') setInstruction('')
    } catch (error) { if (live.current) setError((error as Error).message) }
    finally { working.current = false; if (live.current) setBusy('') }
  }
  async function generate(create = false) {
    if (!library || !template || working.current || !configured || (!create && !instruction.trim())) return
    working.current = true; const before = library, selectedId = activeId, controller = new AbortController()
    request.current = controller; setBusy('model'); setError(''); setMessage('')
    try {
      if (create && before.templates.length >= MAX_TEMPLATES) throw new Error('最多保留五套模板。')
      const snapshot = templateSnapshot(before, selectedId)
      snapshot.sample = template.personalSample; snapshot.sampleChoice = 'personal'
      const body = create ? { action: 'create-template', revision: before.revision, definition, catalog: templateCatalog(before) }
        : { action: 'template-style', revision: before.revision, instruction: instruction.trim(), template: snapshot }
      const { result } = await api('/api/edit', body, controller.signal)
      if (!live.current || controller.signal.aborted) return
      if (result.revision !== before.revision) throw new Error('样稿结果对应旧版设置，请重试。')
      const newId = create ? `custom-${crypto.randomUUID()}` : selectedId
      await commit(changeTemplateLibrary(before, create ? { type: 'add', id: newId, definition, sample: result.sample } : { type: 'edit', id: selectedId, sample: result.sample }), before.revision)
      if (!live.current) return
      setActiveId(newId); setForm(''); setInstruction(''); setMessage(create ? '模板与默认样稿已创建，将参与新资料的自动选择。' : '个人样稿已保存，今后选用此模板的新笔记将采用这份样稿。')
      scroll.current?.scrollTo({ top: 0 })
    } catch (error) { if (live.current) controller.signal.aborted ? setMessage('已取消，原模板与样稿保留。') : setError((error as Error).message) }
    finally { request.current = null; working.current = false; if (live.current) setBusy('') }
  }
  function browse(id: string) { if (busy) return; setActiveId(id); setForm(''); setInstruction(''); setError(''); setMessage(''); setConfirmDelete(false); scroll.current?.scrollTo({ top: 0 }) }
  function openForm(edit = false) {
    setDefinition(edit && template ? { name: template.name, audience: template.audience, organization: template.organization } : { name: '', audience: '', organization: '' })
    setForm(edit ? 'edit' : 'new'); setError(''); setMessage(''); setConfirmDelete(false); scroll.current?.scrollTo({ top: 0 })
  }
  return <Modal title="模板风格" subtitle="让资料找到合适的讲述方式。" wide onClose={() => leave(onClose)}>
    <SettingsSections current="course" onCourse={() => {}} onModel={() => leave(onModel)} onStartup={onStartup?()=>leave(onStartup):undefined} onStorage={onStorage?()=>leave(onStorage):undefined} />
    <div className="course-style-space template-space" aria-busy={!!busy}>
      <aside className="course-style-controls template-controls">
        <div className="template-list-heading"><span>适应学习模板</span><span>{library?.templates.length || builtInTemplates.length} / {Math.max(MAX_TEMPLATES, library?.templates.length || 0)}</span></div>
        <div className="template-list" role="tablist" aria-label="模板列表">
          {(library?.templates || builtInTemplates).map(t => <button key={t.id} role="tab" aria-selected={activeId === t.id && !form} disabled={!library || !!busy} onClick={() => browse(t.id)}>
            {t.layout === 'narrative' ? <BookOpen size={17} /> : t.layout === 'exercise' ? <ListChecks size={17} /> : <FileText size={17} />}<span><strong>{t.name}</strong><small>{t.layout === 'narrative' ? '沿问题展开，张弛有度' : t.layout === 'structured' ? '分层理解，分块回查' : t.layout === 'exercise' ? '原题、思路、解法' : '自定义资料与组织模式'}</small></span><span className="template-kind">{t.layout === 'custom' ? '自定' : '内置'}</span>
          </button>)}
        </div>
        <button className="secondary template-add" disabled={!library || !!busy || library.templates.length >= MAX_TEMPLATES} onClick={() => openForm()}><Plus size={14} />{library?.templates.length === MAX_TEMPLATES ? '已达五套模板上限' : '添加模板'}</button>
        <p className="template-routing-help">首次生成或重新生成时，按学习目标与资料内容选择模板。每套模板独立保留默认样稿与个人样稿。</p>
        {!!library && library.templates.length > MAX_TEMPLATES && <p className="field-help">升级前的模板均已保留。删除到五套以下后可再添加。</p>}
        {!form && template && <>
          <div className="course-style-request">
            <label htmlFor="template-style-instruction">调整这套模板的个人样稿</label>
            <textarea id="template-style-instruction" aria-label="样稿调整要求" rows={4} maxLength={4000} disabled={!!busy || !configured} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="例如：关键推导展开得更细，减少重复解释；让算例的结论更清楚。" />
            {configured ? <button className="primary course-style-adjust" disabled={!!busy || !instruction.trim()} onClick={() => void generate()}>{busy === 'model' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}调整并保存个人样稿</button> : <button className="secondary" onClick={() => leave(onModel)}>连接模型后调整<ArrowRight size={14} /></button>}
          </div>
          <div className="course-style-maintenance"><button className="text-button" disabled={!!busy || !template.editCount} onClick={() => void change({ type: 'reset' }, '个人样稿已恢复默认，可撤销。')}><RotateCcw size={13} />恢复默认</button>{template.undo && <button className="text-button" disabled={!!busy} onClick={() => void change({ type: 'undo' }, '已恢复上一份样稿。')}><Undo2 size={13} />撤销上次修改</button>}</div>
          {custom && <div className="template-custom-actions"><button disabled={!!busy} onClick={() => openForm(true)}>编辑资料对象与组织模式</button><button disabled={!!busy} onClick={() => setConfirmDelete(!confirmDelete)}><Trash2 size={12} />删除模板</button>{confirmDelete && <div className="template-delete"><p>删除“{template.name}”？已生成的笔记与其中的模板快照会保留。</p><button className="secondary" onClick={() => setConfirmDelete(false)}>保留</button><button className="secondary danger" onClick={() => void change({ type: 'delete' }, '自定义模板已删除，已有笔记保留。')}>确认删除</button></div>}</div>}
        </>}
        {busy === 'model' && <button className="text-button template-cancel" onClick={() => request.current?.abort()}>取消请求</button>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <p className="course-style-status" role="status">{busy === 'saving' ? '保存中…' : busy === 'model' ? form === 'new' ? '正在按组织模式编写默认样稿…' : '正在调整个人样稿…' : message || '已有笔记沿用原来的模板。设置保存在本机。'}</p>
      </aside>
      <section className="course-style-preview" ref={scroll} aria-label="模板与样稿">
        {form ? <form className="template-definition-form" onSubmit={e => { e.preventDefault(); if (form === 'new') void generate(true); else void change({ type: 'definition', definition }, '组织模式已保存，两份样稿保留，可继续调整个人样稿。') }}>
          <span className="eyebrow">{form === 'new' ? '新的讲述方式' : '自定义模板'}</span><h3>{form === 'new' ? '添加模板' : '编辑模板'}</h3>
          <p>说明它适合什么资料，以及知识应当怎样组织。{form === 'new' ? '创建时会据此生成一份默认样稿。' : '保存描述不会覆盖已调整的样稿。'}</p>
          <label>模板名称<input aria-label="模板名称" required maxLength={40} value={definition.name} disabled={!!busy} onChange={e => setDefinition({ ...definition, name: e.target.value })} placeholder="例如：方法实践手册" /></label>
          <label>适用资料<textarea aria-label="适用资料" required rows={3} maxLength={2000} disabled={!!busy} value={definition.audience} onChange={e => setDefinition({ ...definition, audience: e.target.value })} placeholder="例如：算法实现教程、实验指导和工程实践材料。" /></label>
          <label>组织模式<textarea aria-label="组织模式" required rows={5} maxLength={4000} disabled={!!busy} value={definition.organization} onChange={e => setDefinition({ ...definition, organization: e.target.value })} placeholder="例如：按任务 → 所需概念 → 操作步骤 → 结果核对组织。每个任务可独立查阅，解释步骤背后的原理。" /></label>
          <div className="template-form-actions"><button type="button" className="secondary" disabled={!!busy} onClick={() => setForm('')}>返回样稿</button>{form === 'new' && !configured ? <button type="button" className="primary" onClick={() => leave(onModel)}>连接模型后创建</button> : <button className="primary" disabled={!!busy || !definition.name.trim() || !definition.audience.trim() || !definition.organization.trim()}>{busy === 'model' && <LoaderCircle className="spin" size={14} />}{form === 'new' ? '创建模板与样稿' : '保存组织模式'}</button>}</div>
        </form> : template && sample ? <>
          <div className="course-style-preview-meta"><span>{template.name}</span><span>{template.selectedSample === 'personal' ? '新笔记采用个人样稿' : '新笔记采用默认样稿'}</span></div>
          <details className="template-description" open><summary>资料对象与组织模式</summary><p>{template.audience}</p><p>{template.organization}</p></details>
          <div className="template-sample-tabs" role="radiogroup" aria-label="此模板使用的样稿">{(['default', 'personal'] as const).map(option => <button role="radio" aria-checked={template.selectedSample === option} disabled={!!busy} key={option} onClick={() => { if (template.selectedSample !== option) void change({ type: 'select', selected: option }, `已选择${option === 'default' ? '默认' : '个人'}样稿，另一份仍保留。`) }}>{option === 'default' ? '默认样稿' : '个人样稿'}{template.selectedSample === option && <Check size={13} />}</button>)}</div>
          <h3>{sample.title}</h3><p className="course-style-preview-intro">{template.layout === 'exercise' ? '原创小题示范逐题组织，保留题面，简洁作答。' : '同一组知识与算例，呈现这套模板的组织与表达。'}</p>
          <details className="course-style-rules"><summary>表达约定</summary><ul>{sample.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></details>
          <Suspense fallback={<p className="field-help">正在排版样稿…</p>}><Preview paragraphs={sample.paragraphs} /></Suspense>
          {template.layout === 'exercise' ? <p className="field-help">题目讲解默认样稿由本项目原创编写，未复制课程习题。</p> : <details className="course-style-attribution"><summary>来源与改编说明</summary><p>{defaultCourseSample.attribution.note} 结构化样稿重新组织了相同主题，自定义样稿及个人样稿会进一步改编表达。</p>{defaultCourseSample.attribution.sources.map(source => <p key={source.url}>{source.authors.join('、')}{source.contributors?.length ? `；${source.contributors.join('、')}` : ''}。<a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · <a href={source.licenseUrl} target="_blank" rel="noreferrer">{source.license}</a></p>)}<p>样稿及改编：<a href={defaultCourseSample.attribution.licenseUrl} target="_blank" rel="noreferrer">{defaultCourseSample.attribution.license}</a></p></details>}
        </> : <p className="field-help">正在读取模板…</p>}
      </section>
    </div>
  </Modal>
}
