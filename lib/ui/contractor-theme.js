export const PORTAL_THEME_KEY = 'dartiq-portal-theme'

export const contractorTheme = {
  pageBg: 'var(--portal-page-bg)',
  pageBgGradient: 'var(--portal-page-bg-gradient)',
  surface: 'var(--portal-surface)',
  border: 'var(--portal-border)',
  borderStrong: 'var(--portal-border-strong)',
  text: 'var(--portal-text)',
  textBody: 'var(--portal-text-body)',
  textMuted: 'var(--portal-text-muted)',
  accent: 'var(--portal-accent)',
  accentHover: 'var(--portal-accent-hover)',
  accentSoft: 'var(--portal-accent-soft)',
  accentGlow: 'var(--portal-accent-glow)',
  success: 'var(--portal-success)',
  successSoft: 'var(--portal-success-soft)',
  warning: 'var(--portal-warning)',
  warningSoft: 'var(--portal-warning-soft)',
  error: 'var(--portal-error)',
  errorSoft: 'var(--portal-error-soft)',
  headerBg: 'var(--portal-header-bg)',
  headerBorder: 'var(--portal-header-border)',
  navBarBg: 'var(--portal-nav-bg)',
  navActive: 'var(--portal-nav-active)',
  navActiveBg: 'var(--portal-nav-active-bg)',
  inputBg: 'var(--portal-input-bg)',
  badgeBg: 'var(--portal-badge-bg)',
  badgeText: 'var(--portal-badge-text)',
  badgeBorder: 'var(--portal-badge-border)',
  shadow: 'var(--portal-shadow)',
  shadowCard: 'var(--portal-shadow-card)',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
  brandName: 'Dart iQ',
  companyLegal: 'Zigamus Technologies, LLC',
  footerYear: '2026',
}

export function getPortalTheme() {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = localStorage.getItem(PORTAL_THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch (_) {}
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyPortalTheme(theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
}

export function togglePortalTheme() {
  const next = getPortalTheme() === 'light' ? 'dark' : 'light'
  try {
    localStorage.setItem(PORTAL_THEME_KEY, next)
  } catch (_) {}
  applyPortalTheme(next)
  return next
}

export function contractorCardStyle() {
  return {
    backgroundColor: contractorTheme.surface,
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '12px',
    boxShadow: contractorTheme.shadowCard,
  }
}

export function contractorStatCardStyle(accentColor) {
  return {
    ...contractorCardStyle(),
    padding: '20px 22px',
    borderTop: '3px solid ' + (accentColor || contractorTheme.accent),
  }
}

export function contractorPrimaryButtonStyle(disabled) {
  return {
    fontSize: '15px',
    padding: '12px 22px',
    minHeight: '44px',
    backgroundColor: disabled ? 'var(--portal-border-strong)' : contractorTheme.accent,
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: '600',
    boxShadow: disabled ? 'none' : contractorTheme.accentGlow,
  }
}

export function contractorInputStyle() {
  return {
    width: '100%',
    padding: '11px 14px',
    minHeight: '44px',
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px',
    fontSize: '16px',
    boxSizing: 'border-box',
    backgroundColor: contractorTheme.inputBg,
    color: contractorTheme.textBody,
  }
}

export function pageTitle(title) {
  return 'Dart iQ — ' + title
}
