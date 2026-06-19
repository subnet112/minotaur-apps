import { useState } from 'react'

interface TokenIconProps {
  glyph: string
  iconClass: string
  /** Logo image URL (Superchain list or SmolDapp CDN). Falls back to the glyph. */
  logoUri?: string
  alt?: string
}

/**
 * Token badge. Renders the logo image when a `logoUri` is present, and falls
 * back to the symbol-glyph badge if there is no logo or the image fails to
 * load (404 / network). Uses the same `ico ${iconClass}` classes as the glyph
 * span so it inherits the circular badge sizing from the parent (.sw-tok /
 * .sw-tmod-row). Images load cross-origin via <img>, so no CORS concern.
 */
export default function TokenIcon({ glyph, iconClass, logoUri, alt }: TokenIconProps) {
  const [failed, setFailed] = useState(false)
  if (logoUri && !failed) {
    return (
      <img
        className={`ico ico-img ${iconClass}`}
        src={logoUri}
        alt={alt ?? glyph}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }
  return <span className={`ico ${iconClass}`}>{glyph}</span>
}
