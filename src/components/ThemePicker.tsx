import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { visualThemes, type VisualTheme } from '../theme'

export function ThemePicker({ theme, onTheme }: { theme: VisualTheme; onTheme: (theme: VisualTheme) => void }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }
  const show = (index = visualThemes.findIndex(option => option.id === theme)) => {
    setFocusedIndex(index)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const button = trigger.current!.getBoundingClientRect()
      const panel = menu.current!.getBoundingClientRect()
      const left = Math.max(12, Math.min(button.right - panel.width, window.innerWidth - panel.width - 12))
      const below = button.bottom + 9
      const top = below + panel.height <= window.innerHeight - 12 ? below : Math.max(12, button.top - panel.height - 9)
      setPosition({ left, top })
    }
    place()
    options.current[focusedIndex]?.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, focusedIndex])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  return <div className="theme-picker" ref={root} data-keyboard={keyboardFocus ? '' : undefined}
    onPointerDownCapture={() => setKeyboardFocus(false)} onKeyDownCapture={() => setKeyboardFocus(true)} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button type="button" className="theme-trigger" ref={trigger} aria-label="切换视觉风格"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => open ? close() : show()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          show(event.key === 'ArrowUp' ? visualThemes.length - 1 : 0)
        }
      }}>
      <span className="theme-swatch" aria-hidden="true" /><span>外观</span><ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <div className="theme-menu" ref={menu} style={position}>
      <div className="theme-menu-heading" id={`${menuId}-label`}>阅读外观</div>
      <div className="theme-options" id={menuId} role="menu" aria-labelledby={`${menuId}-label`} onKeyDown={event => {
        if (event.key === 'Tab') {
          close(true)
        } else if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); close(true)
        } else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? visualThemes.length - 1
            : (focusedIndex + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + visualThemes.length) % visualThemes.length
          setFocusedIndex(next)
        }
      }}>
        {visualThemes.map((option, index) => <button type="button" key={option.id} ref={element => { options.current[index] = element }}
          className="theme-option" data-theme-preview={option.id} role="menuitemradio" aria-checked={theme === option.id}
          tabIndex={focusedIndex === index ? 0 : -1} onFocus={() => setFocusedIndex(index)}
          onClick={() => { if (theme !== option.id) onTheme(option.id); close(true) }}>
          <span className="theme-preview" aria-hidden="true">
            <span className="theme-preview-rail" /><span className="theme-preview-page">
              <span className="theme-preview-type">Aa</span>
              <span className="theme-preview-line" /><span className="theme-preview-line short" /><span className="theme-preview-note" />
            </span>
          </span>
          <span className="theme-option-label">{option.label}<span className="theme-option-check" aria-hidden="true">{theme === option.id && <Check size={10} strokeWidth={2.5} />}</span></span>
        </button>)}
      </div>
    </div>}
  </div>
}
