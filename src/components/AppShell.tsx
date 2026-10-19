import type { ReactNode } from 'react'
import { BookOpen, CircleHelp, FilePlus2, Library, Network, Settings2, UserRound } from 'lucide-react'
import type { VisualTheme } from '../theme'
import { ThemePicker } from './ThemePicker'
import { brand } from '../../shared/brand.mjs'
import { BrandMark } from './BrandMark'

type View = 'library' | 'tree' | 'reader'

export function AppNavigation({ view, canRead, onNavigate, onImport, onProfile, onHelp, onSettings }: {
  view: View; canRead: boolean; onNavigate: (view: View) => void;
  onImport: () => void; onProfile: () => void; onHelp: () => void; onSettings: () => void;
}) {
  return <nav className="app-rail" aria-label="主导航">
    <button className="brand-mark" title={`${brand.windowTitle} · 资料库`} aria-label="打开资料库" onClick={() => onNavigate('library')}><BrandMark size={30} /></button>
    <div className="rail-main collection-navigation">
      <button className={`rail-button ${view === 'library' ? 'active' : ''}`} aria-label="资料库" aria-current={view === 'library' ? 'page' : undefined} onClick={() => onNavigate('library')}><Library size={20} /><span>资料库</span></button>
      <button className={`rail-button ${view === 'tree' ? 'active' : ''}`} aria-label="学习树" aria-current={view === 'tree' ? 'page' : undefined} onClick={() => onNavigate('tree')}><Network size={20} /><span>学习树</span></button>
      <button className={`rail-button ${view === 'reader' ? 'active' : ''}`} aria-label="学习工作台" aria-current={view === 'reader' ? 'page' : undefined} disabled={!canRead} title={canRead ? '继续阅读当前资料' : '从资料库打开一份资料'} onClick={() => onNavigate('reader')}><BookOpen size={20} /><span>阅读</span></button>
    </div>
    <div className="rail-secondary"><button className="rail-button" aria-label="导入学习资料" onClick={onImport}><FilePlus2 size={20} /><span>导入</span></button></div>
    <div className="rail-bottom">
      <button className="rail-button roots-entry" aria-label="根系 · 学习画像" onClick={onProfile}><UserRound size={19} /><span>根系</span></button>
      <button className="rail-button" aria-label="使用指南" onClick={onHelp}><CircleHelp size={19} /><span>帮助</span></button>
      <button className="rail-button" aria-label="模型设置" onClick={onSettings}><Settings2 size={19} /><span>设置</span></button>
    </div>
  </nav>
}

export function WorkspaceBrand({ onHome }: { onHome: () => void }) {
  return <div className="sidebar-top shell-brand-row"><button className="collection-brand" onClick={onHome} aria-label={`${brand.windowTitle} · 返回资料库`}><span>{brand.name}<small>{brand.englishName}</small></span></button></div>
}

export function WorkspaceHeader({ children, actions, theme, onTheme, className = '' }: {
  children: ReactNode; actions?: ReactNode; theme: VisualTheme; onTheme: (theme: VisualTheme) => void; className?: string;
}) {
  return <header className={`shell-header ${className}`}><div className="breadcrumb">{children}</div><div className="header-actions">{actions}<ThemePicker theme={theme} onTheme={onTheme} /></div></header>
}
