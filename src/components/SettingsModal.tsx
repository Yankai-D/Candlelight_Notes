import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, LockKeyhole, Pencil, RotateCcw, Sparkles } from 'lucide-react'
import { Modal } from './Modal'
import { SettingsSections } from './TemplateStyleModal'
import { defaultModelConnection, defaultStartupMode, startupModes } from '../../shared/app-settings.mjs'
import type { ModelConfig, ReaderStartupMode } from '../types'
import '../settings.css'
import { StorageLocation } from './StorageLocation'
import { storageSettings, setStorageDirectory, type StorageSettings } from '../storage'

type Props = { config: ModelConfig; onClose: () => void; onCourseStyle: () => void; onDiscover?: () => void; onMaintenance?: () => void; api: (path: string, body: unknown) => Promise<any>; onSave: (data: Partial<ModelConfig>) => void; initialSection?: 'model' | 'startup' | 'storage' }
export function SettingsModal({config,onClose,onCourseStyle,onDiscover,onMaintenance,api,onSave,initialSection='model'}: Props) {
  const [section,setSection]=useState(initialSection)
  const [baseUrl,setBaseUrl]=useState(config.baseUrl||defaultModelConnection.baseUrl),[model,setModel]=useState(config.model||defaultModelConnection.model),[key,setKey]=useState('')
  const [editing,setEditing]=useState(!config.configured),[confirmation,setConfirmation]=useState<'reset'|'clear'|null>(null)
  const [startup,setStartup]=useState<ReaderStartupMode>(config.startupMode||defaultStartupMode)
  const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('')
  const working=useRef(false)
  const [location,setLocation]=useState<StorageSettings|null>(null),[directory,setDirectory]=useState('')
  useEffect(()=>{if(section==='storage')void storageSettings().then(value=>{setLocation(value);setDirectory(value.directory||'')}).catch(error=>setError(error.message))},[section])
  const draft=()=>({baseUrl:baseUrl.trim(),model:model.trim(),...(key.trim()?{apiKey:key.trim()}: {})})
  function discard() {setBaseUrl(config.baseUrl);setModel(config.model);setKey('');setEditing(false);setConfirmation(null);setError('');setMessage('')}
  function navigate(next:'model'|'startup'|'storage') {if(working.current)return;discard();setStartup(config.startupMode||defaultStartupMode);setSection(next)}
  async function saveLocation() {
    if(working.current)return;working.current=true;setBusy('storage');setError('');setMessage('')
    try {const value=await setStorageDirectory(directory);setDirectory(value.directory);setLocation(previous=>({...previous,enabled:true,...value}));setMessage('保存位置已更新，下次导入时使用。已有资料和笔记保持原位置。')}
    catch(error){setError((error as Error).message)}finally{working.current=false;setBusy('')}
  }
  async function perform(action:'save'|'test'|'reset'|'clear'|'startup') {
    if(working.current)return
    working.current=true;setBusy(action);setError('');setMessage('')
    try {
      if(action==='test') {await api('/api/test',editing?draft():{});setMessage(editing?'草稿连接成功；点击保存后才会生效。':'连接成功。')}
      else {
        const result=await api(action==='reset'?'/api/config/reset':'/api/config',action==='reset'?{}:action==='clear'?{apiKey:''}:action==='startup'?{startupMode:startup}:draft())
        onSave(result);setBaseUrl(result.baseUrl);setModel(result.model);setKey('');setEditing(false);setConfirmation(null)
        setMessage(action==='reset'?'已恢复默认连接，并清除本机保存的 Key。':action==='clear'?'已从本机 .env 清除 Key。':action==='startup'?'启动方式已保存，下次进入资料时生效。':'连接已保存到本机 .env，重启后继续生效。')
      }
    } catch(e){setError((e as Error).message)}finally{working.current=false;setBusy('')}
  }
  const leave=(callback:()=>void)=>{if(!working.current)callback()}
  return <Modal title="设置" subtitle={section==='storage'?'管理资料与笔记的保存位置。':section==='model'?'管理保存在本机的模型连接。':'选择进入资料时的阅读方式。'} onClose={()=>leave(onClose)}>
    <SettingsSections current={section} onModel={()=>navigate('model')} onCourse={()=>leave(onCourseStyle)} onStartup={()=>navigate('startup')} onStorage={()=>navigate('storage')} />
    <div className="settings-form settings-panel">
      {section==='model'?<>
        <div className="provider-card"><span className="provider-icon"><Sparkles size={24}/></span><div><b>模型连接</b><span>兼容 Chat Completions</span></div><span className={config.configured?'provider-status on':'provider-status'}>{config.configured?'已配置':'未配置'}</span></div>
        {!editing?<>
          <dl className="connection-summary"><dt>API 地址</dt><dd>{config.baseUrl}</dd><dt>模型</dt><dd>{config.model}</dd><dt>API Key</dt><dd>{config.configured?'已保存 · 不显示密钥':'未设置'}</dd></dl>
          <div className="connection-lock"><span><LockKeyhole size={14}/>连接设置已锁定</span><button className="secondary" disabled={!!busy} onClick={()=>{setEditing(true);setMessage('');setError('')}}><Pencil size={13}/>修改连接</button></div>
        </>:<fieldset className="connection-fields" disabled={!!busy}>
          <label>API 地址<input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder={defaultModelConnection.baseUrl} autoComplete="off"/></label>
          <label>模型名称<input value={model} onChange={e=>setModel(e.target.value)} list="model-list"/><datalist id="model-list"><option value="deepseek-flash"/><option value="deepseek-v4-pro"/><option value="deepseek-chat"/></datalist></label>
          <label>API Key<input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder={config.configured?'已保存 · 留空保留当前 Key':'输入 API Key'} autoComplete="off"/></label>
        </fieldset>}
        <p className="field-help">保存后写入{window.pangzhuDesktop ? '本机应用数据目录' : '本机项目目录'}的 .env，不保存在浏览器，也不会在界面回显。测试草稿不会覆盖已保存的连接。</p>
        {confirmation?<div className="settings-confirm" role="group" aria-label="确认连接更改"><p>{confirmation==='reset'?'恢复默认 API 地址和模型，并清除本机保存的 Key。阅读启动方式与笔记不受影响。':'清除本机保存的 Key，之后需要重新填写才能调用模型。'}</p><div className="modal-actions"><button className="secondary" disabled={!!busy} onClick={()=>setConfirmation(null)}>取消</button><button className="primary" disabled={!!busy} onClick={()=>void perform(confirmation)}>{confirmation==='reset'?'确认恢复默认':'确认清除 Key'}</button></div></div>:<>
          <div className="modal-actions"><button className="secondary" disabled={!!busy||!baseUrl.trim()||!model.trim()||(!config.configured&&!key.trim())} onClick={()=>void perform('test')}>{busy==='test'&&<LoaderCircle size={14} className="spin"/>}测试连接</button><div className="spacer"/>{editing&&<><button className="text-button" disabled={!!busy} onClick={discard}>取消修改</button><button className="primary" disabled={!!busy||!baseUrl.trim()||!model.trim()} onClick={()=>void perform('save')}>{busy==='save'&&<LoaderCircle size={14} className="spin"/>}保存连接</button></>}</div>
          <div className="connection-maintenance"><button disabled={!!busy} onClick={()=>{setConfirmation('reset');setError('');setMessage('')}}><RotateCcw size={13}/>恢复默认连接</button>{config.configured&&<button disabled={!!busy} onClick={()=>{setConfirmation('clear');setError('');setMessage('')}}>清除 Key</button>}</div>
        </>}
      </>:section==='storage'?<>
        {location?.maintenance && onMaintenance && <div className="discovery-entry"><strong>备份与恢复</strong><p className="field-help">完整备份学习空间，恢复移除的记录，或管理回收站。</p><button className="secondary" disabled={!!busy} onClick={()=>leave(onMaintenance)}>资料备份与恢复</button></div>}
        {location?.discovery && onDiscover && <div className="discovery-entry"><strong>找回已有学习笔记</strong><p className="field-help">启动时识别默认资料目录。其他位置的笔记可选择目录后加入。</p><button className="secondary" disabled={!!busy} onClick={()=>leave(onDiscover)}>识别已有笔记</button></div>}
        {location?.enabled?<><StorageLocation value={directory} onChange={setDirectory} disabled={!!busy}/><p className="field-help">资料与笔记保存为独立文件。卸载保留它们和轻量路径索引，清除 API Key 与缓存；内置描述性统计原文随程序卸载。</p><div className="modal-actions"><div className="spacer"/><button className="primary" disabled={!!busy||!directory.trim()||directory===location.directory} onClick={()=>void saveLocation()}>保存位置</button></div></>:<p className="field-help">{location?'当前使用浏览器存储，请更新本机服务以启用文件资料库。':'正在读取保存位置…'}</p>}
      </>:<>
        <div className="startup-options" role="radiogroup" aria-label="进入资料时的启动方式">{startupModes.map(mode=><label key={mode.id} className={`startup-option ${startup===mode.id?'selected':''}`}><input type="radio" name="startup-mode" value={mode.id} checked={startup===mode.id} disabled={!!busy} onChange={()=>setStartup(mode.id as ReaderStartupMode)}/><span><strong>{mode.label}{mode.id==='adaptive'&&<small>默认</small>}</strong><span>{mode.description}</span></span></label>)}</div>
        <p className="field-help">已有笔记直接打开，缺少所选版本时才生成。两种笔记分别保存；设置不会重写正文或改变正在阅读的版本。</p>
        <div className="modal-actions"><div className="spacer"/><button className="primary" disabled={!!busy||startup===(config.startupMode||defaultStartupMode)} onClick={()=>void perform('startup')}>{busy==='startup'&&<LoaderCircle size={14} className="spin"/>}保存启动方式</button></div>
      </>}
      {message&&<p className="success-message" role="status"><Check size={15}/>{message}</p>}{error&&<p className="inline-error" role="alert">{error}</p>}
    </div>
  </Modal>
}
