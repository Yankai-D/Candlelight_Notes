import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './learning.css'
import './themes.css'
import './collection.css'
import './study-tree.css'
import './ideal-tree.css'
import './shell.css'
import './course-style.css'
import { applyVisualTheme, readVisualTheme } from './theme'

applyVisualTheme(readVisualTheme())
createRoot(document.getElementById('root')!).render(<App />)
