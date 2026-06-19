/**
 * TokenIcon: renders the logo image when a logoUri is present, and falls back
 * to the symbol glyph when there's no logo or the image fails to load.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TokenIcon from '@/components/dex-aggregator/TokenIcon'

describe('TokenIcon', () => {
  it('renders the logo image when logoUri is provided', () => {
    render(<TokenIcon glyph="A" iconClass="unknown" logoUri="https://cdn/logo.png" alt="AERO" />)
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://cdn/logo.png')
    expect(img.getAttribute('alt')).toBe('AERO')
    expect(img.className).toContain('ico')
    expect(img.className).toContain('ico-img')
  })

  it('falls back to the glyph badge when there is no logoUri', () => {
    render(<TokenIcon glyph="X" iconClass="unknown" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('X')).toBeTruthy()
  })

  it('falls back to the glyph when the image fails to load', () => {
    render(<TokenIcon glyph="Z" iconClass="eth" logoUri="https://cdn/missing.png" />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Z')).toBeTruthy()
  })
})
