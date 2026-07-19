export const adminTheme = {
  pageBg: 'var(--portal-page-bg)',
  surface: 'var(--portal-surface)',
  surfaceRaised: 'var(--portal-surface-raised)',
  border: 'var(--portal-border)',
  borderSubtle: 'var(--portal-border)',
  text: 'var(--portal-text)',
  textMuted: 'var(--portal-text-muted)',
  textDim: 'var(--portal-text-dim)',
  accent: 'var(--portal-accent)',
  accentStrong: 'var(--portal-accent-hover)',
  warning: 'var(--portal-warning)',
  success: 'var(--portal-success)',
  danger: 'var(--portal-danger)',
  headerBg: 'var(--portal-header-bg)',
  navActive: 'var(--portal-nav-active)',
  navAccent: 'var(--portal-nav-accent)',
  badgeBg: 'var(--portal-badge-bg)',
  badgeText: 'var(--portal-badge-text)',
  badgeBorder: 'var(--portal-badge-border)',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  sidebarWidth: '220px',
}

/** Shared shell tokens for admin + contractor sidebars (keep in sync). */
export const portalShellTheme = adminTheme

/** Class that applies the Railway-style dot-grid canvas (see app/portal-shell.css). */
export const portalShellRootClassName = 'portal-shell-canvas'

export function portalShellRootStyle() {
  return {
    minHeight: '100vh',
    // Background (dot grid + base) comes from .portal-shell-canvas + data-theme
    color: portalShellTheme.text,
    display: 'flex',
  }
}

export function portalAsideStyle() {
  return {
    width: portalShellTheme.sidebarWidth,
    flexShrink: 0,
    backgroundColor: portalShellTheme.headerBg,
    borderRight: '1px solid ' + portalShellTheme.border,
    backdropFilter: 'blur(8px)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    position: 'sticky',
    top: 0,
    alignSelf: 'flex-start',
  }
}

export function portalNavItemStyle(active) {
  return {
    textAlign: 'left',
    fontSize: '13px',
    padding: '10px 12px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontFamily: portalShellTheme.fontMono,
    backgroundColor: active ? portalShellTheme.navActive : 'transparent',
    color: active ? portalShellTheme.text : portalShellTheme.textMuted,
    fontWeight: active ? '600' : '400',
    borderLeft: active
      ? '3px solid ' + portalShellTheme.navAccent
      : '3px solid transparent',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
  }
}

export function portalSectionLabelStyle() {
  return {
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: portalShellTheme.textDim,
    fontFamily: portalShellTheme.fontMono,
    padding: '12px 12px 6px',
    margin: 0,
  }
}

export function portalSignOutButtonStyle() {
  return {
    width: '100%',
    fontSize: '11px',
    padding: '8px 12px',
    border: '1px solid ' + portalShellTheme.border,
    borderRadius: '6px',
    backgroundColor: portalShellTheme.surface,
    color: portalShellTheme.textMuted,
    cursor: 'pointer',
    fontFamily: portalShellTheme.fontMono,
  }
}

export function adminStatCardStyle(accentColor) {
  return {
    backgroundColor: adminTheme.surfaceRaised,
    border: '1px solid ' + adminTheme.border,
    borderRadius: '8px',
    padding: '14px 16px',
    borderLeft: '3px solid ' + (accentColor || adminTheme.accent),
    backdropFilter: 'blur(8px)',
    boxShadow: 'var(--portal-shadow-card)',
  }
}

export function adminPanelStyle() {
  return {
    backgroundColor: adminTheme.surface,
    border: '1px solid ' + adminTheme.border,
    borderRadius: '8px',
    overflow: 'hidden',
    backdropFilter: 'blur(8px)',
    boxShadow: 'var(--portal-shadow-card)',
  }
}
