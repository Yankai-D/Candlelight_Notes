export const visualThemes = [
  { id: 'sage', label: '淡绿' },
  { id: 'dark', label: '黑底白字' },
  { id: 'light', label: '白底黑字' },
] as const

export type VisualTheme = typeof visualThemes[number]['id']
const preferenceKey = 'reading-tree-visual-theme'
let transitionFrame = 0

export function readVisualTheme(): VisualTheme {
  try {
    const saved = window.localStorage.getItem(preferenceKey)
    if (visualThemes.some(theme => theme.id === saved)) return saved as VisualTheme
  } catch { /* Reading still works when browser storage is unavailable. */ }
  return 'sage'
}

export function applyVisualTheme(theme: VisualTheme) {
  if (document.documentElement.dataset.theme === theme) return
  // Apply the palette as a single change. Existing button hover transitions
  // otherwise trail behind the page and briefly blend old and new colors.
  cancelAnimationFrame(transitionFrame)
  document.documentElement.dataset.themeChanging = ''
  document.documentElement.dataset.theme = theme
  transitionFrame = requestAnimationFrame(() => {
    transitionFrame = requestAnimationFrame(() => { delete document.documentElement.dataset.themeChanging })
  })
}

export function saveVisualTheme(theme: VisualTheme) {
  applyVisualTheme(theme)
  try { window.localStorage.setItem(preferenceKey, theme) } catch { /* Keep the selection for this session. */ }
}
