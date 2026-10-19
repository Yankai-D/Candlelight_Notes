import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleHelp, LoaderCircle, LockKeyhole } from 'lucide-react'
import { brand } from '../../shared/brand.mjs'
import { defaultModelConnection } from '../../shared/app-settings.mjs'
import { profileFromFields } from '../../shared/learner-setup.mjs'
import type { Knowledge, LearnerProfile, ModelConfig } from '../types'
import type { VisualTheme } from '../theme'
import { BrandMark } from './BrandMark'
import { ThemePicker } from './ThemePicker'
import '../welcome.css'

type Props = {
  step: 'profile' | 'connection'; knowledge: Knowledge; config: ModelConfig; configReady: boolean;
  theme: VisualTheme; onTheme: (value: VisualTheme) => void; onHelp: () => void; onBack: () => void;
  onProfile: (value: LearnerProfile) => Promise<void>; onFinish: () => Promise<void>;
  api: (path: string, body: unknown) => Promise<any>; onConfig: (value: Partial<ModelConfig>) => void;
  onBusy: (value: boolean) => void;
}
export function Onboarding({ step, knowledge, config, configReady, theme, onTheme, onHelp, onBack, onProfile, onFinish, api, onConfig, onBusy }: Props) {
  const [background, setBackground] = useState(knowledge.background)
  const [foundations, setFoundations] = useState(knowledge.foundations.join('、'))
  const [key, setKey] = useState(''), [editing, setEditing] = useState(!config.configured)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
  const working = useRef(false)
  const connectionInitialized = useRef(configReady)
  useEffect(() => { if (configReady && !connectionInitialized.current) { connectionInitialized.current = true; setEditing(!config.configured) } }, [configReady, config.configured])
  async function perform(action: 'profile' | 'skip-profile' | 'save' | 'test' | 'finish') {
    if (working.current) return
    working.current = true; setBusy(action); onBusy(true); setError(''); setMessage('')
    try {
      if (action === 'profile') await onProfile(profileFromFields(background, foundations))
      else if (action === 'skip-profile') await onProfile({ background: knowledge.background, foundations: knowledge.foundations })
      else if (action === 'finish') await onFinish()
      else {
        if (!config.token) throw new Error('连接设置暂不可用。可以先进入，稍后在设置中配置模型。')
        const draft = editing ? { ...defaultModelConnection, apiKey: key.trim() } : {}
        if (editing && !key.trim()) throw new Error('请填写 DeepSeek API Key。')
        if (action === 'test') { await api('/api/test', draft); setMessage(editing ? '测试成功。点击“保存连接”后才会保存 Key。' : '连接成功。') }
        else { const saved = await api('/api/config', draft); onConfig(saved); setKey(''); setEditing(false); setMessage('连接已保存到本机，可以开始使用。') }
      }
    } catch (reason) { setError((reason as Error).message) }
    finally { working.current = false; setBusy(''); onBusy(false) }
  }
  return <main className="welcome" aria-label="首次使用设置">
    <header className="welcome-header"><div className="welcome-brand"><BrandMark size={38} /><span>{brand.name}<small>{brand.englishName}</small></span></div><div><button className="welcome-help" onClick={onHelp}><CircleHelp size={17} />使用指南</button><ThemePicker theme={theme} onTheme={onTheme} /></div></header>
    <div className="welcome-body"><section className="welcome-story"><span className="welcome-eyebrow">一份属于你的学习笔记</span><h1>从你的起点，<br />读懂更远的知识。</h1><p>让讲解知道你已经走到了哪里，<br />再一起梳理问题、推敲原理、留下旁注。</p><div className="welcome-principles"><span>画像决定铺垫的深浅</span><span>目标指引每一次学习</span><span>笔记由你与 AI 共同维护</span></div><small>{brand.tagline}</small></section>
    <section className="welcome-card" aria-labelledby="welcome-title"><ol className="welcome-steps" aria-label="设置进度"><li aria-current={step === 'profile' ? 'step' : undefined}><span>{step === 'connection' ? <Check size={12} /> : '1'}</span>学习画像</li><li aria-current={step === 'connection' ? 'step' : undefined}><span>2</span>模型连接</li></ol>
      {step === 'profile' ? <form onSubmit={event => { event.preventDefault(); void perform('profile') }}>
        <h2 id="welcome-title">认识你的学习起点</h2><p className="welcome-description">让讲解从你熟悉的知识出发。</p>
        <fieldset disabled={!!busy} className="welcome-fields"><label htmlFor="welcome-background">学习背景</label><textarea id="welcome-background" aria-label="学习背景" autoFocus maxLength={4000} value={background} onChange={event => { setBackground(event.target.value); setError('') }} placeholder="你目前的学习阶段、专业或经验。" rows={3} />
        <label htmlFor="welcome-foundations">已具备的基础</label><textarea id="welcome-foundations" aria-label="已具备的基础" value={foundations} onChange={event => { setFoundations(event.target.value); setError('') }} placeholder="你确认具备的基础，用顿号或换行分隔。" rows={2} /></fieldset>
        <p className="welcome-note">之后可在「根系」中修改。阅读记录不会自动变成你已掌握的知识；纯翻译不使用画像。</p>
        {error && <p className="inline-error" role="alert">{error}</p>}<div className="welcome-profile-actions"><button type="button" className="text-button welcome-skip" disabled={!!busy} onClick={() => void perform('skip-profile')}>跳过</button><button className="primary welcome-next" disabled={!!busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <>继续<ArrowRight size={16} /></>}</button></div>
      </form> : <div className="welcome-connection"><h2 id="welcome-title">让 AI 加入你的学习</h2><p className="welcome-description">连接 DeepSeek，一起整理与讲解你的资料。</p>
        {config.configured && !editing ? <div className="welcome-connected"><Check size={22} /><div><strong>已有保存的模型连接</strong><span>{config.model}</span><small>Key 已保存在本机，不会回显。</small></div></div> : <div className="welcome-key"><label htmlFor="welcome-key">DeepSeek API Key</label><input id="welcome-key" aria-label="DeepSeek API Key" type="password" autoComplete="off" value={key} disabled={!!busy} onChange={event => { setKey(event.target.value); setError(''); setMessage('') }} placeholder="在这里粘贴你的 Key" /><span>使用 DeepSeek 默认连接 · {defaultModelConnection.model}</span><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">前往 DeepSeek 获取 API Key ↗</a></div>}
        <p className="welcome-note"><LockKeyhole size={13} />Key 仅保存到本机。生成时会将相关资料、学习目标，以及适应性讲解所需的画像发给你配置的模型。</p>
        <div className="welcome-connect-actions"><button className="secondary" disabled={!!busy || !configReady || !config.token || editing && !key.trim()} onClick={() => void perform('test')}>{busy === 'test' ? <LoaderCircle size={14} className="spin" /> : null}测试连接</button>{editing ? <button className="primary" disabled={!!busy || !configReady || !config.token || !key.trim()} onClick={() => void perform('save')}>{busy === 'save' ? <LoaderCircle size={14} className="spin" /> : null}保存连接</button> : <button className="text-button" disabled={!!busy} onClick={() => { setEditing(true); setMessage(''); setError('') }}>更换为 DeepSeek</button>}</div>
        <p className="welcome-test-note">测试会发起一次简短请求；仅填写或保存 Key 不会生成笔记。</p>
        {configReady && !config.token && <p className="inline-error" role="alert">连接设置暂不可用，可先进入资料库，稍后在设置中重试。</p>}{message && <p className="welcome-success" role="status">{message}</p>}{error && <p className="inline-error" role="alert">{error}</p>}
        <div className="welcome-finish"><button className="text-button" disabled={!!busy} onClick={onBack}><ArrowLeft size={14} />返回画像</button><button className="primary" disabled={!!busy} onClick={() => void perform('finish')}>{busy === 'finish' ? <LoaderCircle size={15} className="spin" /> : <>{config.configured ? '进入资料库' : '跳过'}<ArrowRight size={15} /></>}</button></div>
      </div>}
    </section></div><footer className="welcome-footer">你的画像与连接设置，始终由你掌握。</footer>
  </main>
}
