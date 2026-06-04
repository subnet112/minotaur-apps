import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'

const SwapPage = lazy(() => import('@/pages/SwapPage'))
const UserOrdersPage = lazy(() => import('@/pages/UserOrdersPage'))

// BrowserRouter's basename in main.tsx is BASE_URL (= /swap in prod), so
// the routes here are all relative to the basename — root maps to the
// swap form, /orders maps to the wallet-scoped order history.
export default function App() {
  return (
    <Suspense fallback={<div className="dex-stage" aria-label="Loading" />}>
      <Routes>
        <Route path="/" element={<SwapPage />} />
        <Route path="/swap" element={<SwapPage />} />
        <Route path="/orders" element={<UserOrdersPage />} />
        <Route
          path="*"
          element={
            <div className="dex-stage" aria-label="Not found">
              <div className="dex-content">
                <p>Route not found.</p>
              </div>
            </div>
          }
        />
      </Routes>
    </Suspense>
  )
}
