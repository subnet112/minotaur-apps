/**
 * BracketCorners — the four `.ct tl/tr/bl/br` spans that decorate every
 * framed surface in the design system (App card, Toast, Command palette,
 * Stage frames, Form shells, etc.).
 *
 * How it works: each consuming container has `position: relative` and
 * scoped CSS that positions / sizes / colors these spans. This component
 * just emits the markup; sizing is the parent's job. See e.g.
 * `.app-toast > .ct`, `.app-card > .ct`, `.m-shell > .ct` in components.css.
 *
 * Usage:
 *   <div class="app-toast">
 *     <BracketCorners />
 *     ... toast content ...
 *   </div>
 */
export default function BracketCorners() {
  return (
    <>
      <span className="ct tl" aria-hidden="true" />
      <span className="ct tr" aria-hidden="true" />
      <span className="ct bl" aria-hidden="true" />
      <span className="ct br" aria-hidden="true" />
    </>
  )
}
