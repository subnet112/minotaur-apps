import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/shell'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { wagmiConfig } from '@/config/wagmi'

// CSS order matters — tokens first (variables), then layout, then components.
import '@/styles/tokens.css'
import '@/styles/page.css'
import '@/styles/components.css'
import '@/styles/components-swap.css'
import '@/styles/extensions.css'
// RainbowKit's modal CSS — loaded LAST so any tokens.css overrides on shared
// vars (--rk-*) take precedence. Without this the connect modal renders
// completely unstyled (a wall of links).
import '@rainbow-me/rainbowkit/styles.css'

import App from './App'

// Single query client for the whole app. wagmi 2.x uses TanStack Query under
// the hood for its hooks (useReadContract / useWriteContract / useBalance …).
const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#CBFD12',          // --lime — matches the design accent
            accentColorForeground: '#141414', // --void
            borderRadius: 'small',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          <BrowserRouter>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
)
