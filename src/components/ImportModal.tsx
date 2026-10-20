import {useEffect,useRef,useState} from 'react'
import {ArrowRight,FolderOpen,LoaderCircle,Upload,Check,FileText,X} from 'lucide-react'
import {Modal} from './Modal'
import {StorageLocation} from './StorageLocation'
import * as storage from '../storage'
import type {LearningDocument} from '../types'
import {materialAccept,materialFormat} from '../../shared/material-formats.mjs'
import {defaultLearningIntent} from '../../shared/learning-intent.mjs'
import {deferredMaterial} from '../../shared/material-ingestion.mjs'

type Entry={file:File;path:string;document?:LearningDocument;status:'waiting'|'saving'|'done'|'error';error?:string}
export function ImportModal({onClose,onImport,onComplete,onBusy}:{onClose:()=>void;onImport:(document:LearningDocument,file:File,directory?:string,relativePath?:string)=>Promise<void>;onComplete:(count:number)=>void;onBusy:(busy:boolean,stop?:()=>void)=>void}){
  const [entries,setEntries]=useState<Entry[]>([]),[intent,setIntent]=useState(defaultLearningIntent),[policy,setPolicy]=useState<'manual'|'automatic'>('automatic')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[location,setLocation]=useState<storage.StorageSettings|null>(null)
  const input=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null),stop=useRef(false)
  useEffect(()=>{folderInput.current?.setAttribute('webkitdirectory','');void storage.storageSettings().then(setLocation).catch(error=>setError(error.message))},[])
  useEffect(()=>()=>{stop.current=true},[])
  function choose(files:FileList|null){
    if(!files||busy)return
    const supported=Array.from(files).filter(file=>materialFormat(file.name)||/\.json$/i.test(file.name))
    if(supported.length>100){setError('每批最多 100 份资料，请分批添加。');return}
    const next=supported.sort((a,b)=>(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name,'zh-CN',{numeric:true})).map(file=>({file,path:file.webkitRelativePath||'',status:'waiting' as const}))
    setEntries(next);setPolicy(next.length>1||next.some(e=>e.path)?'manual':'automatic');setError(supported.length<files.length?`已跳过 ${files.length-supported.length} 个不支持的附件或文件。`:'')
  }
  async function submit(){
    if(busy)return
    stop.current=false;setBusy(true);onBusy(true,()=>{stop.current=true});setError('')
    const next=entries.map(entry=>({...entry}));let failed=0
    try{
      for(const entry of next){
        if(stop.current)break
        if(entry.status==='done')continue
        entry.status='saving';entry.error='';setEntries([...next])
        try{
          if(!entry.document)entry.document=/\.json$/i.test(entry.file.name)
            ? (await import('../../shared/backup.mjs')).restoreBackup(await entry.file.text()) as LearningDocument
            : deferredMaterial(entry.file,intent,policy) as LearningDocument
          await onImport(entry.document,entry.file,location?.enabled?location.directory:undefined,entry.path)
          entry.status='done'
        }catch(error){entry.status='error';entry.error=(error as Error).message;failed++}
        setEntries([...next])
      }
      if(next.every(entry=>entry.status==='done'))onComplete(next.length)
      else if(failed)setError(`${failed} 份未完成，已成功添加的资料会保留。可重试未完成文件。`)
    }finally{setBusy(false);onBusy(false)}
  }
  const done=entries.filter(e=>e.status==='done').length
  return <Modal title="添加学习资料" subtitle="保存原件，在需要时生成笔记，或用整个资料包整理独立笔记。" explicitCancel={!!entries.length||busy} onClose={()=>{if(!busy)onClose()}}>
    <div className="import-form"><div className="import-fields">
      <button className="drop-zone" disabled={busy||done>0} onClick={()=>input.current?.click()} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!done)choose(event.dataTransfer.files)}}><span className="upload-circle"><Upload size={26}/></span><strong>{entries.length?`已选择 ${entries.length} 份资料`:'选择或拖入学习资料'}</strong><span>支持多选 · PDF / Word / PowerPoint / HTML / Markdown / TXT</span><small>每份最多 50 MB · 每批最多 100 份</small></button>
      <input ref={input} type="file" multiple accept={materialAccept+',.json'} hidden disabled={busy} onChange={event=>choose(event.target.files)}/>
      <input ref={folderInput} type="file" multiple hidden disabled={busy} onChange={event=>choose(event.target.files)}/>
      <button className="secondary" disabled={busy||done>0} onClick={()=>folderInput.current?.click()}><FolderOpen size={15}/>选择整个文件夹</button>
      <p className="field-help">文件夹导入保留层级，新建文件夹作为联合资料包。原件先保存，正文在阅读或整理独立笔记时提取，不逐文件调用模型。</p>
      {!!entries.length&&<div className="batch-import-list" aria-label="导入文件列表">{entries.map((entry,index)=><div className={`batch-import-entry ${entry.status}`} key={index}>{entry.status==='done'?<Check size={15}/>:entry.status==='saving'?<LoaderCircle size={15} className="spin"/>:<FileText size={15}/>}<span title={entry.path||entry.file.name}>{entry.path||entry.file.name}{entry.error&&<small>{entry.error}</small>}</span><small>{entry.status==='done'?'已保存':entry.status==='saving'?'保存中':entry.status==='error'?'未完成':`${(entry.file.size/1024/1024).toFixed(1)} MB`}</small>{entry.status!=='done'&&<button className="text-button" aria-label={`移除 ${entry.file.name}`} disabled={busy} onClick={()=>setEntries(entries.filter((_,i)=>i!==index))}><X size={14}/></button>}</div>)}</div>}
      <fieldset className="import-reading-policy" disabled={busy||done>0}><legend>单份资料的笔记</legend><label><input type="radio" name="import-policy" checked={policy==='manual'} onChange={()=>setPolicy('manual')}/>仅添加资料，需要时再生成</label><label><input type="radio" name="import-policy" checked={policy==='automatic'} onChange={()=>setPolicy('automatic')}/>打开资料时按阅读设置生成</label></fieldset>
      <label>学习目标<textarea rows={2} maxLength={4000} disabled={busy||done>0} value={intent} onChange={event=>setIntent(event.target.value)}/></label>
      <p className="field-help">独立笔记另行填写要求，可分别创建知识讲义、题解或其他成果。</p>
      {entries.some(e=>/\.json$/i.test(e.file.name))&&<p className="field-help">JSON 恢复已有笔记，通常不含原始文件；完整迁移请使用资料备份。</p>}
      {location?.enabled&&<StorageLocation value={location.directory||''} disabled={busy||done>0} onChange={directory=>setLocation(current=>current?{...current,directory}:null)}/>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
      </div><div className="modal-actions"><span className="field-help" role="status">{entries.length?`已保存 ${done} / ${entries.length}`:'资料保存在本机'}</span><div className="spacer"/>{busy?<button className="secondary" onClick={()=>{stop.current=true}}>停止导入</button>:<button className="secondary" onClick={onClose}>{done?'关闭':'取消'}</button>}<button className="primary" disabled={busy||!entries.length||!location||!intent.trim()||(location.enabled&&!location.directory?.trim())} onClick={()=>void submit()}>{busy?<LoaderCircle size={15} className="spin"/>:<ArrowRight size={15}/>} {busy?'正在保存…':entries.some(e=>e.status==='error')?'重试未完成文件':'添加到资料库'}</button></div></div>
  </Modal>
}
