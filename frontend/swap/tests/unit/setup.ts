import '@testing-library/jest-dom/vitest'

// Stub localStorage (jsdom has one but isolate per-test in case tests mutate)
beforeEach(() => {
  localStorage.clear()
})

// Stub window.matchMedia (some design components may use it)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})
