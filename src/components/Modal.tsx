import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === ref.current) { const r = ref.current!.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose() } }} aria-label={title}>
    <div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>
}
