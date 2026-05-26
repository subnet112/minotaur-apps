import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/shell'

import AppPageHeader from '@/components/dex-aggregator/AppPageHeader'
import WalletButton from '@/components/dex-aggregator/WalletButton'
import HeaderIconButton from '@/components/dex-aggregator/HeaderIconButton'
import RevealPanel from '@/components/dex-aggregator/RevealPanel'
import WalletModeBlock from '@/components/dex-aggregator/WalletModeBlock'
import ActionButton from '@/components/dex-aggregator/ActionButton'

const wrap = (node: React.ReactNode) => (
  <BrowserRouter><ToastProvider>{node}</ToastProvider></BrowserRouter>
)

describe('design components — smoke render', () => {
  it('AppPageHeader renders identity strip + 4 bracket corners', () => {
    const { container } = render(wrap(<AppPageHeader actions={null} />))
    expect(container.querySelector('.app-ph')).toBeInTheDocument()
    expect(container.querySelectorAll('.ct').length).toBe(4)
    expect(container.textContent).toContain('Minotaur')
    expect(container.textContent).toContain('Swap')
  })

  it('WalletButton renders disconnected state', () => {
    const { container } = render(wrap(<WalletButton mode="disconnected" onClick={() => {}} />))
    expect(container.querySelector('.app-wallet')).toBeInTheDocument()
    expect(container.textContent).toMatch(/Connect/i)
  })

  it('WalletButton renders connected metamask state with mode chip', () => {
    const { container } = render(wrap(<WalletButton mode="metamask" onClick={() => {}} />))
    expect(container.querySelector('.app-wallet.is-connected.is-metamask')).toBeInTheDocument()
  })

  it('HeaderIconButton renders with role + active state', () => {
    const { container } = render(wrap(<HeaderIconButton role="history" active onClick={() => {}} />))
    expect(container.querySelector('.app-ph-icon.is-active')).toBeInTheDocument()
  })

  it('RevealPanel role=history renders empty state when wallet disconnected', () => {
    const { container } = render(wrap(<RevealPanel role="history" wallet="disconnected" onClose={() => {}} />))
    expect(container.querySelector('.app-rpanel')).toBeInTheDocument()
    expect(container.querySelectorAll('.ct').length).toBe(4)
  })

  it('WalletModeBlock renders create-wallet variant with primary CTA', () => {
    const { container } = render(wrap(<WalletModeBlock variant="create-wallet" />))
    expect(container.querySelector('.sw-mode')).toBeInTheDocument()
    expect(container.querySelector('.sw-mode-btn.is-primary')).toBeInTheDocument()
  })

  it('ActionButton renders is-disconnected modifier', () => {
    const { container } = render(wrap(<ActionButton state="disconnected" onClick={() => {}} />))
    expect(container.querySelector('.sw-cta.is-disconnected')).toBeInTheDocument()
  })

  it('ActionButton renders is-fetching with spinner', () => {
    const { container } = render(wrap(<ActionButton state="fetching" onClick={() => {}} />))
    expect(container.querySelector('.sw-cta.is-fetching')).toBeInTheDocument()
    expect(container.querySelector('.spinner')).toBeInTheDocument()
  })
})
