import { useState } from 'react'
import { ChevronRight, FileText, Plus, Search, Trash2 } from 'lucide-react'
import type { LearningDocument } from '../types'
import { orderLibraryDocuments } from '../../shared/library.mjs'
import { Modal } from './Modal'

type Props = { documents: LearningDocument[]; activeId: string; onClose: () => void; onSelect: (id: string) => void; onImport: () => void; onDelete: (id: string) => void }

export function LibraryModal({ documents, activeId, onClose, onSelect, onImport, onDelete }: Props) {
  const [query, setQuery] = useState('')
  const [deleteId, setDeleteId] = useState('')
  const filtered = (orderLibraryDocuments(documents) as LearningDocument[]).filter(doc =>
    [doc.title, doc.subtitle, doc.filename, doc.library?.label, doc.library?.authors].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return <Modal title="我的书单" subtitle={`已添加 ${documents.length} 份资料`} onClose={onClose} wide>
    <div className="library-tools">
      <div className="search-field"><Search size={16} /><input aria-label="搜索学习资料" value={query} placeholder="搜索标题或作者" onChange={e => setQuery(e.target.value)} /></div>
      <button className="primary" onClick={onImport}><Plus size={15} /> 导入资料</button>
    </div>
    <div className="library-list paper-library" role="list" aria-label="已添加的资料">
      {filtered.map(doc => <div key={doc.id} role="listitem" className={`library-item ${doc.id === activeId ? 'current' : ''}`}>
        <span className="library-file-icon"><FileText size={21} strokeWidth={1.4} /></span>
        <button className="library-item-main" aria-label={`打开 ${doc.library?.label || doc.title}`} onClick={() => onSelect(doc.id)}>
          <strong>{doc.library?.label || doc.title}{doc.id === activeId && <small>当前阅读</small>}</strong>
          {doc.library && <span className="paper-original-title">{doc.title}</span>}
          <span className="paper-details">{[doc.library?.authors, doc.library?.year, doc.kind === 'pdf' ? 'PDF' : '文本', `${doc.pages.length} 页`].filter(Boolean).join(' · ')}</span>
        </button>
        {documents.length > 1 && <button className={`icon-button ${deleteId === doc.id ? 'delete-confirm' : ''}`} title={deleteId === doc.id ? '再次点击确认移除' : '移除资料'} aria-label={deleteId === doc.id ? `确认删除 ${doc.title}` : `移除 ${doc.title}`} onClick={() => deleteId === doc.id ? onDelete(doc.id) : setDeleteId(doc.id)}>{deleteId === doc.id ? '确认移除' : <Trash2 size={14} />}</button>}
        <ChevronRight size={15} />
      </div>)}
      {!filtered.length && <div className="modal-empty">{query.trim() ? '没有匹配的资料，试试其他标题或作者。' : '还没有添加资料。'}</div>}
    </div>
  </Modal>
}
