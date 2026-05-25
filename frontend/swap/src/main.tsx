import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/shell'

// CSS order matters — tokens first (variables), then layout, then components.
import '@/styles/tokens.css'
import '@/styles/page.css'
import '@/styles/components.css'
import '@/styles/components-swap.css'
import '@/styles/extensions.css'

import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
)
