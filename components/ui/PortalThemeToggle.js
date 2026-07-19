'use client'

import { useEffect, useState } from 'react'
import {
  applyPortalTheme,
  getPortalTheme,
  togglePortalTheme,
} from '../../lib/ui/contractor-theme'

/**
 * Sun/moon control — toggles html[data-theme] + .dark/.light instantly via CSS vars.
 */
export default function PortalThemeToggle() {
  const [theme, setTheme] = useState('dark')

  useEffect(function () {
    const initial = getPortalTheme()
    applyPortalTheme(initial)
    setTheme(initial)
  }, [])

  function handleToggle() {
    const next = togglePortalTheme()
    setTheme(next)
  }

  return (
    <button
      type="button"
      className="portal-theme-toggle"
      onClick={handleToggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      <svg className="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg className="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
      </svg>
    </button>
  )
}
