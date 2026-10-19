import { FolderOpen } from 'lucide-react'
import { useState } from 'react'

export function StorageLocation({ value, onChange, disabled = false, label = '资料与笔记保存位置', help = '确认导入后记住这个位置，下次自动沿用。已有资料继续保存在原位置。' }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string; help?: string }) {
  const [choosing, setChoosing] = useState(false), [error, setError] = useState('')
  async function choose() {
    setChoosing(true); setError('')
    try { const directory = await window.pangzhuDesktop?.chooseLibraryDirectory(value); if (directory) onChange(directory) }
    catch { setError('文件夹选择器暂时无法打开，可以直接填写路径。') }
    finally { setChoosing(false) }
  }
  return <div className="storage-location">
    <label>{label}<div className="storage-path"><input aria-label={label} value={value} disabled={disabled || choosing} onChange={event => onChange(event.target.value)} placeholder="选择文件夹" spellCheck={false} />{window.pangzhuDesktop && <button type="button" className="secondary" disabled={disabled || choosing} onClick={() => void choose()}><FolderOpen size={15} />选择文件夹</button>}</div></label>
    <p className="field-help">{help}</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>
}
