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
          {/* basename mirrors vite's BASE_URL so the router works both in
              dev (served at /) and in the production build (served at
              /swap/ by apps/app's iframe). Without this, /swap/orders
              would fall through to the 404 route because the router
              would try to match it as a fully-rooted path. */}
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
)
