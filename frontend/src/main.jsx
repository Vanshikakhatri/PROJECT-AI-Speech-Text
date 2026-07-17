import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Self-hosted fonts (bundled locally by Vite — no network request, ever).
// Poppins replaces Space Grotesk as the display font: same clean/professional
// role, but its rounded letterforms give the UI a friendlier, cuter feel.
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
