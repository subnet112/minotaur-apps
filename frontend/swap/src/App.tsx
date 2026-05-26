import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

const SwapPage = lazy(() => import('@/pages/SwapPage'))

export default function App() {
  return (
    <Suspense fallback={<div className="dex-stage" aria-label="Loading" />}>
      <Routes>
        <Route path="/" element={<Navigate to="/swap" replace />} />
        <Route path="/swap" element={<SwapPage />} />
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
